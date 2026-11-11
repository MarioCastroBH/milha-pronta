import {
  firebaseConfig, LAR_ID, DEFAULTS, PARTICIPANTES, CATEGORIAS,
} from "./firebase-config.js";
import {
  fechamentoDaCompra,
  fechamentoDaCompraDaParcela,
  vencimentoDaFatura,
  chaveData,
  dividirParcelas,
  parseValorBR,
  parseDataISO,
  formatarData,
  formatarReal,
} from "./dominio.js";
import {
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebase = initializeApp(firebaseConfig);
const auth = getAuth(firebase);
const db = initializeFirestore(firebase, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const raiz = document.getElementById("app");
let instalacaoDisponivel = null;
let lar = null;
let abaAtiva = "fatura";

// Ícones em SVG embutido: não dependem de internet nem de fontes externas.
const ICONES = {
  fatura: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  lancar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>',
};

const ICONE_SAIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>';

const ABAS = [
  { id: "fatura", rotulo: "Fatura" },
  { id: "lancar", rotulo: "Lançar" },
  { id: "ajustes", rotulo: "Ajustes" },
];

// --- Utilidades ---------------------------------------------------------

function esc(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function mensagemDeErro(codigo) {
  const mapa = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/email-already-in-use": "Este e-mail já tem conta. Use Entrar.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/network-request-failed": "Sem conexão. Tente de novo quando a internet voltar.",
    "permission-denied": "Esta conta não tem acesso aos dados do lar.",
    "unavailable": "Não foi possível falar com o servidor. Verifique a internet.",
  };
  return mapa[codigo] || "Algo deu errado. Tente novamente.";
}

// Aviso flutuante: confirma sucesso ou mostra erro.
function mostrarAviso(texto, tipo = "info") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.className = `toast visivel ${tipo}`;
  clearTimeout(el._temporizador);
  el._temporizador = setTimeout(() => el.classList.remove("visivel"), 3500);
}

// Mostra estado de "trabalhando" no botão e desabilita os botões do mesmo formulário.
async function comCarregamento(botao, textoEspera, acao) {
  const textoOriginal = botao.textContent;
  const grupo = botao.form ? [...botao.form.querySelectorAll("button")] : [botao];
  grupo.forEach((b) => { b.disabled = true; });
  botao.classList.add("ocupado");
  botao.textContent = textoEspera;
  try {
    return await acao();
  } finally {
    grupo.forEach((b) => { b.disabled = false; });
    botao.classList.remove("ocupado");
    botao.textContent = textoOriginal;
  }
}

function nomeDoUsuario(usuario) {
  return PARTICIPANTES[usuario.uid] || usuario.email;
}

function ehIphoneSemInstalar() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

// --- Dados ---------------------------------------------------------------

async function garantirLar() {
  const ref = doc(db, "lares", LAR_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...DEFAULTS, criadoEm: new Date() });
    return { ...DEFAULTS };
  }
  return snap.data();
}

function refLancamentos() {
  return collection(db, "lares", LAR_ID, "lancamentos");
}

async function carregarFatura(chave) {
  const snap = await getDocs(query(refLancamentos(), where("faturaFechamento", "==", chave)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.dataCompra.toMillis() - a.dataCompra.toMillis());
}

// Retorna null se salvou, ou a mensagem de validação.
async function salvarCompra(form, usuario) {
  const descricao = form.descricao.value.trim();
  const valor = parseValorBR(form.valor.value);
  const parcelas = Number(form.parcelas.value);
  const dataCompra = parseDataISO(form.data.value);

  if (!descricao) return "Informe a descrição da compra.";
  if (!Number.isInteger(valor) || valor <= 0) return "Informe um valor válido, por exemplo 129,90.";
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 36) return "Use de 1 a 36 parcelas.";
  if (Number.isNaN(dataCompra.getTime())) return "Informe uma data válida.";

  const grupoId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const colecao = refLancamentos();
  const lote = writeBatch(db);

  dividirParcelas(valor, parcelas).forEach((valorCentavos, i) => {
    const n = i + 1;
    const fechamentoDaParcela = fechamentoDaCompraDaParcela(dataCompra, lar.diaFechamento, n);
    lote.set(doc(colecao), {
      descricao,
      categoria: form.categoria.value,
      cartaoFinal: form.cartao.value,
      portador: form.portador.value,
      valorCentavos,
      dataCompra,
      parcela: n,
      totalParcelas: parcelas,
      grupoId,
      faturaFechamento: chaveData(fechamentoDaParcela),
      lancadoPorUid: usuario.uid,
      lancadoPorNome: nomeDoUsuario(usuario),
      origem: "manual",
      criadoEm: new Date(),
    });
  });

  await lote.commit();
  return null;
}

async function excluirGrupo(grupoId) {
  const snap = await getDocs(query(refLancamentos(), where("grupoId", "==", grupoId)));
  const lote = writeBatch(db);
  snap.docs.forEach((d) => lote.delete(d.ref));
  await lote.commit();
}

// --- Telas ---------------------------------------------------------------

function renderLogin(mensagem = "") {
  raiz.innerHTML = `
    <section class="cartao login">
      <h1>Milha Pronta</h1>
      <form id="form-login">
        <label>E-mail
          <input type="email" name="email" required autocomplete="username">
        </label>
        <label>Senha
          <input type="password" name="senha" required minlength="6" autocomplete="current-password">
        </label>
        <div class="acoes">
          <button type="submit" name="acao" value="entrar">Entrar</button>
          <button type="submit" name="acao" value="criar" class="secundario">Criar conta</button>
        </div>
        <p class="erro" id="erro"></p>
      </form>
    </section>`;

  document.getElementById("erro").textContent = mensagem;

  document.getElementById("form-login").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const form = evento.target;
    const botao = evento.submitter || form.querySelector("button[type=submit]");
    const email = form.email.value.trim();
    const senha = form.senha.value;
    const criar = botao.value === "criar";
    const erro = document.getElementById("erro");
    erro.textContent = "";

    await comCarregamento(botao, criar ? "Criando conta…" : "Entrando…", async () => {
      try {
        if (criar) {
          await createUserWithEmailAndPassword(auth, email, senha);
        } else {
          await signInWithEmailAndPassword(auth, email, senha);
        }
      } catch (e) {
        const msg = mensagemDeErro(e.code);
        erro.textContent = msg;
        mostrarAviso(msg, "erro");
      }
    });
  });
}

function blocoInstalar() {
  if (instalacaoDisponivel) {
    return `
      <section class="cartao">
        <h2>Instalar</h2>
        <button id="btn-instalar">Instalar app</button>
      </section>`;
  }
  if (ehIphoneSemInstalar()) {
    return `
      <section class="cartao">
        <h2>Instalar</h2>
        <p>No Safari, toque em <strong>Compartilhar</strong> e depois em
          <strong>Adicionar à Tela de Início</strong>.</p>
      </section>`;
  }
  return "";
}

function telaFatura(fechamento, vencimento, lancamentos, total, resumoPorPortador, erroCarga) {
  const itens = lancamentos.map((l) => {
    const parcela = l.totalParcelas > 1 ? `parcela ${l.parcela} de ${l.totalParcelas} · ` : "";
    return `
      <li class="item">
        <div class="linha">
          <strong>${esc(l.descricao)}</strong>
          <span>${esc(formatarReal(l.valorCentavos))}</span>
        </div>
        <div class="detalhe">${esc(formatarData(l.dataCompra.toDate()))} · ${esc(parcela)}final ${esc(l.cartaoFinal)} · ${esc(l.portador)} · ${esc(l.categoria)}</div>
        <div class="detalhe">lançado por ${esc(l.lancadoPorNome)}
          <button class="link" data-excluir="${esc(l.grupoId)}">excluir compra</button>
        </div>
      </li>`;
  }).join("");

  return `
    <section class="cartao">
      <h2>Ciclo atual</h2>
      <p>Compras feitas hoje entram na fatura que fecha em
        <strong>${esc(formatarData(fechamento))}</strong> e vence em
        <strong>${esc(formatarData(vencimento))}</strong>.</p>
      <p><strong>Total lançado nesta fatura:</strong> ${esc(formatarReal(total))}</p>
      <p class="dica">${resumoPorPortador || "Nenhuma compra lançada ainda."}</p>
      ${erroCarga ? `<p class="erro">${esc(erroCarga)}</p>` : ""}
    </section>

    <section class="cartao">
      <h2>Compras desta fatura</h2>
      ${lancamentos.length
        ? `<ul class="lista">${itens}</ul>`
        : `<p class="dica">Nenhuma compra lançada neste ciclo. Use a aba Lançar para registrar a primeira.</p>`}
    </section>`;
}

function telaLancar(hoje, opcoesCartao, opcoesPortador, opcoesCategoria) {
  return `
    <section class="cartao">
      <h2>Nova compra</h2>
      <form id="form-compra">
        <label>Descrição
          <input name="descricao" required maxlength="80">
        </label>
        <label>Valor total (R$)
          <input name="valor" inputmode="decimal" placeholder="0,00" required>
        </label>
        <label>Data da compra
          <input type="date" name="data" required value="${esc(chaveData(hoje))}">
        </label>
        <label>Parcelas
          <input type="number" name="parcelas" min="1" max="36" value="1" required>
        </label>
        <label>Cartão
          <select name="cartao">${opcoesCartao}</select>
        </label>
        <label>Portador do cartão
          <select name="portador">${opcoesPortador}</select>
        </label>
        <label>Categoria
          <select name="categoria">${opcoesCategoria}</select>
        </label>
        <button type="submit">Salvar compra</button>
        <p class="erro" id="erro-compra"></p>
      </form>
    </section>`;
}

function telaAjustes(cartoes) {
  return `
    <section class="cartao">
      <h2>Cartões</h2>
      <ul>${cartoes}</ul>
    </section>

    <section class="cartao">
      <h2>Ciclo</h2>
      <form id="form-config">
        <label>Dia de fechamento (1 a 28)
          <input type="number" name="diaFechamento" min="1" max="28" required value="${esc(lar.diaFechamento)}">
        </label>
        <label>Dia de vencimento (1 a 28)
          <input type="number" name="diaVencimento" min="1" max="28" required value="${esc(lar.diaVencimento)}">
        </label>
        <button type="submit">Salvar</button>
        <p class="erro" id="erro-config"></p>
      </form>
    </section>

    ${blocoInstalar()}`;
}

function barraInferior() {
  const botoes = ABAS.map((aba) => `
    <button type="button" data-aba="${aba.id}" ${aba.id === abaAtiva ? 'aria-current="page"' : ""}>
      ${ICONES[aba.id]}
      <span>${esc(aba.rotulo)}</span>
    </button>`).join("");
  const botaoSair = `
    <button type="button" data-acao="sair">
      ${ICONE_SAIR}
      <span>Sair</span>
    </button>`;
  return `<nav class="barra-inferior" aria-label="Navegação principal">${botoes}${botaoSair}</nav>`;
}

async function renderApp(usuario) {
  const hoje = new Date();
  const fechamento = fechamentoDaCompra(hoje, lar.diaFechamento);
  const vencimento = vencimentoDaFatura(fechamento, lar.diaVencimento);
  const chave = chaveData(fechamento);

  let lancamentos = [];
  let erroCarga = "";
  try {
    lancamentos = await carregarFatura(chave);
  } catch (e) {
    erroCarga = mensagemDeErro(e.code);
  }

  const total = lancamentos.reduce((soma, l) => soma + l.valorCentavos, 0);
  const porPortador = {};
  lancamentos.forEach((l) => {
    porPortador[l.portador] = (porPortador[l.portador] || 0) + l.valorCentavos;
  });
  const resumoPorPortador = Object.entries(porPortador)
    .map(([nome, valor]) => `${esc(nome)}: ${esc(formatarReal(valor))}`)
    .join(" · ");

  const opcoesCartao = lar.cartoes
    .map((c) => `<option value="${esc(c.final)}">final ${esc(c.final)} · ${esc(c.tipo)}</option>`)
    .join("");
  const opcoesPortador = Object.values(PARTICIPANTES)
    .map((nome) => `<option>${esc(nome)}</option>`)
    .join("");
  const opcoesCategoria = CATEGORIAS
    .map((c) => `<option>${esc(c)}</option>`)
    .join("");
  const cartoes = lar.cartoes
    .map((c) => `<li>final ${esc(c.final)} · ${esc(c.tipo)}</li>`)
    .join("");

  let conteudo = "";
  if (abaAtiva === "lancar") {
    conteudo = telaLancar(hoje, opcoesCartao, opcoesPortador, opcoesCategoria);
  } else if (abaAtiva === "ajustes") {
    conteudo = telaAjustes(cartoes);
  } else {
    conteudo = telaFatura(fechamento, vencimento, lancamentos, total, resumoPorPortador, erroCarga);
  }

  raiz.innerHTML = `
    <header class="topo">
      <span>${esc(nomeDoUsuario(usuario))}</span>
    </header>
    ${conteudo}
    ${barraInferior()}`;

  const btnSairBarra = raiz.querySelector("[data-acao='sair']");
  if (btnSairBarra) {
    btnSairBarra.addEventListener("click", (evento) => {
      comCarregamento(evento.currentTarget, "Saindo…", () => signOut(auth)).catch(() => {
        mostrarAviso("Não foi possível sair. Tente de novo.", "erro");
      });
    });
  }

  raiz.querySelectorAll("[data-aba]").forEach((botao) => {
    botao.addEventListener("click", () => {
      abaAtiva = botao.dataset.aba;
      renderApp(usuario);
    });
  });

  const formCompra = document.getElementById("form-compra");
  if (formCompra) {
    formCompra.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const form = evento.target;
      const botao = evento.submitter || form.querySelector("button[type=submit]");
      const erro = document.getElementById("erro-compra");
      erro.textContent = "";

      await comCarregamento(botao, "Salvando…", async () => {
        try {
          const msg = await salvarCompra(form, usuario);
          if (msg) {
            erro.textContent = msg;
            mostrarAviso(msg, "erro");
            return;
          }
          mostrarAviso("Compra salva com sucesso.", "sucesso");
          abaAtiva = "fatura";
          await renderApp(usuario);
        } catch (e) {
          const msg = mensagemDeErro(e.code);
          erro.textContent = msg;
          mostrarAviso(msg, "erro");
        }
      });
    });
  }

  raiz.querySelectorAll("[data-excluir]").forEach((botao) => {
    botao.addEventListener("click", async () => {
      if (!confirm("Excluir esta compra? Se for parcelada, todas as parcelas serão removidas.")) return;
      await comCarregamento(botao, "Excluindo…", async () => {
        try {
          await excluirGrupo(botao.dataset.excluir);
          mostrarAviso("Compra excluída.", "sucesso");
          await renderApp(usuario);
        } catch (e) {
          mostrarAviso(mensagemDeErro(e.code), "erro");
        }
      });
    });
  });

  const formConfig = document.getElementById("form-config");
  if (formConfig) {
    formConfig.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const form = evento.target;
      const botao = evento.submitter || form.querySelector("button[type=submit]");
      const diaFechamento = Number(form.diaFechamento.value);
      const diaVencimento = Number(form.diaVencimento.value);
      const erro = document.getElementById("erro-config");
      erro.textContent = "";

      if (!Number.isInteger(diaFechamento) || diaFechamento < 1 || diaFechamento > 28 ||
          !Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 28) {
        erro.textContent = "Use dias entre 1 e 28.";
        return;
      }

      await comCarregamento(botao, "Salvando…", async () => {
        try {
          await updateDoc(doc(db, "lares", LAR_ID), { diaFechamento, diaVencimento });
          lar = { ...lar, diaFechamento, diaVencimento };
          mostrarAviso("Configuração salva.", "sucesso");
          await renderApp(usuario);
        } catch (e) {
          const msg = mensagemDeErro(e.code);
          erro.textContent = msg;
          mostrarAviso(msg, "erro");
        }
      });
    });
  }

  const btnInstalar = document.getElementById("btn-instalar");
  if (btnInstalar) {
    btnInstalar.addEventListener("click", async () => {
      instalacaoDisponivel.prompt();
      await instalacaoDisponivel.userChoice;
      instalacaoDisponivel = null;
      await renderApp(usuario);
    });
  }
}

function renderSemAcesso(mensagem) {
  raiz.innerHTML = `
    <section class="cartao">
      <h1>Milha Pronta</h1>
      <p class="erro"></p>
      <button id="btn-sair" class="secundario">Sair</button>
    </section>`;
  raiz.querySelector(".erro").textContent = mensagem;
  document.getElementById("btn-sair").addEventListener("click", (evento) => {
    comCarregamento(evento.currentTarget, "Saindo…", () => signOut(auth));
  });
}

// --- Inicialização -------------------------------------------------------

window.addEventListener("beforeinstallprompt", (evento) => {
  evento.preventDefault();
  instalacaoDisponivel = evento;
});

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    renderLogin();
    return;
  }
  try {
    lar = await garantirLar();
    await renderApp(usuario);
  } catch (e) {
    renderSemAcesso(mensagemDeErro(e.code));
  }
});

if ("serviceWorker" in navigator) {
  // Se já havia uma versão controlando a página e uma nova assumiu, recarrega sozinha.
  const jaTinhaVersao = !!navigator.serviceWorker.controller;
  let recarregando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (jaTinhaVersao && !recarregando) {
      recarregando = true;
      window.location.reload();
    }
  });
  // Pede ao navegador que verifique agora se existe uma versão nova do sw.js.
  navigator.serviceWorker.register("./sw.js")
    .then((registro) => registro.update())
    .catch(() => {});
}
