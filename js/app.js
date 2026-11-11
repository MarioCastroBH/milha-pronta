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
import { lerFatura } from "./importador.js";
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
  deleteField,
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
let usuarioAtual = null;
// Cada renderização recebe um número; só a mais recente pode escrever na tela.
// Assim, uma tela antiga que termina depois não sobrescreve a atual.
let versaoRender = 0;
// Prévia da importação da planilha do Itaú. Fica só na tela até confirmar ou cancelar.
let previaImportacao = null;

// Sair: encerra a sessão e mostra o login direto, sem depender de estado anterior.
async function sair() {
  try {
    await signOut(auth);
  } catch (e) {
    mostrarAviso("Não foi possível sair. Tente de novo.", "erro");
    return;
  }
  usuarioAtual = null;
  lar = null;
  abaAtiva = "fatura";
  previaImportacao = null;
  renderLogin();
}

// Ícones em SVG embutido: não dependem de internet nem de fontes externas.
const ICONES = {
  fatura: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  reserva: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h.01"/></svg>',
  lancar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>',
};

const ICONE_SAIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>';

const ABAS = [
  { id: "fatura", rotulo: "Fatura" },
  { id: "reserva", rotulo: "Reserva" },
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

// Qualquer toque na tela fecha o aviso que estiver aberto.
document.addEventListener("click", () => {
  const aviso = document.getElementById("toast");
  if (aviso) aviso.classList.remove("visivel");
});

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

function somar(lista) {
  return lista.reduce((soma, l) => soma + l.valorCentavos, 0);
}

// --- Ciclo e semanas -----------------------------------------------------

// Compras de um dia entram na fatura que fecha no dia de fechamento seguinte.
// Logo, o ciclo vai do dia de fechamento anterior (incluso) até o dia antes do próximo fechamento.
function calcularCiclo(hoje) {
  const fechamento = fechamentoDaCompra(hoje, lar.diaFechamento);
  const inicio = new Date(fechamento.getFullYear(), fechamento.getMonth() - 1, fechamento.getDate());
  const fim = new Date(fechamento.getFullYear(), fechamento.getMonth(), fechamento.getDate() - 1);
  return { fechamento, inicio, fim, chave: chaveData(fechamento) };
}

// Divide o ciclo em blocos de 7 dias, começando no início do ciclo.
function semanasDoCiclo(inicio, fim) {
  const semanas = [];
  let atual = new Date(inicio);
  while (atual <= fim) {
    const fimBruto = new Date(atual.getFullYear(), atual.getMonth(), atual.getDate() + 6);
    const termina = fimBruto > fim ? fim : fimBruto;
    semanas.push({ numero: semanas.length + 1, inicio: new Date(atual), fim: new Date(termina) });
    atual = new Date(atual.getFullYear(), atual.getMonth(), atual.getDate() + 7);
  }
  return semanas;
}

function dentroDe(data, inicio, fim) {
  const k = chaveData(data);
  return k >= chaveData(inicio) && k <= chaveData(fim);
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

async function carregarReserva(chave) {
  const snap = await getDoc(doc(db, "lares", LAR_ID, "reservas", chave));
  return snap.exists() ? snap.data() : {};
}

async function salvarTransferencia(chave, item, valorCentavos, marcar, usuario) {
  const dados = marcar
    ? { feito: true, valorCentavos, feitoPorNome: nomeDoUsuario(usuario), feitoEm: new Date() }
    : { feito: false, valorCentavos: null, feitoPorNome: null, feitoEm: null };
  await setDoc(doc(db, "lares", LAR_ID, "reservas", chave), { itens: { [item]: dados } }, { merge: true });
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

// --- Importação da fatura do Itaú ---------------------------------------

// Mesma compra, mesma parcela, mesmo cartão e mesma data = mesmo lançamento.
// A descrição não entra porque o banco a corta de um jeito diferente do que digitamos.
function chaveDedup(l) {
  return `${l.cartaoFinal}|${l.valorCentavos}|${chaveData(l.dataCompra)}|${l.parcela}|${l.totalParcelas}`;
}

// Todos os lançamentos do lar, já com a data como Date. Usado na Fatura (busca e agrupamento) e na importação.
async function carregarTodosLancamentos() {
  const snap = await getDocs(refLancamentos());
  return snap.docs.map((d) => {
    const dados = d.data();
    return { id: d.id, ...dados, dataCompra: dados.dataCompra.toDate() };
  });
}

// Monta a prévia sem gravar nada: confere totais, vencimento e quantos lançamentos serão substituídos.
async function montarPrevia(fatura) {
  if (!fatura.vencimento) {
    throw new Error("Não encontrei a data de vencimento na planilha.");
  }
  if (!fatura.lancamentos.length) {
    throw new Error("Não encontrei compras positivas nesta planilha.");
  }

  // A fatura fecha no mês anterior ao vencimento, no dia de fechamento do lar.
  const fechamento = new Date(fatura.vencimento.getFullYear(), fatura.vencimento.getMonth() - 1, lar.diaFechamento);
  const vencimentoApp = vencimentoDaFatura(fechamento, lar.diaVencimento);
  const chaveFatura = chaveData(fechamento);

  const lancamentos = fatura.lancamentos.map((l) => ({ ...l, faturaFechamento: chaveFatura }));
  const totalImportado = somar(lancamentos);

  const existentes = await carregarTodosLancamentos();
  const chaves = new Set(lancamentos.map(chaveDedup));
  const substituindo = existentes.filter((e) => chaves.has(chaveDedup(e))).length;

  return {
    chaveFatura,
    fechamento,
    vencimento: vencimentoApp,
    vencimentoArquivo: fatura.vencimento,
    vencimentoConfere: chaveData(vencimentoApp) === chaveData(fatura.vencimento),
    lancamentos,
    ignorados: fatura.ignorados,
    totalImportado,
    totalArquivo: fatura.valorParcialCentavos,
    totalConfere: fatura.valorParcialCentavos === totalImportado,
    substituindo,
  };
}

async function verPreviaImportacao(usuario, botao) {
  const erro = document.getElementById("erro-importacao");
  const arquivo = document.getElementById("arquivo-fatura").files[0];
  erro.textContent = "";
  if (!arquivo) {
    erro.textContent = "Escolha a planilha primeiro.";
    return;
  }
  await comCarregamento(botao, "Lendo planilha…", async () => {
    try {
      const fatura = await lerFatura(await arquivo.arrayBuffer());
      previaImportacao = await montarPrevia(fatura);
      await renderApp(usuario);
    } catch (e) {
      const msg = e.code ? mensagemDeErro(e.code) : (e.message || "Não consegui ler esta planilha.");
      erro.textContent = msg;
      mostrarAviso(msg, "erro");
    }
  });
}

async function confirmarImportacao(usuario, botao) {
  const previa = previaImportacao;
  if (!previa) return;
  const texto = `Importar ${previa.lancamentos.length} compras e substituir ${previa.substituindo} lançamentos existentes?`;
  if (!confirm(texto)) return;

  await comCarregamento(botao, "Importando…", async () => {
    try {
      const existentes = await carregarTodosLancamentos();
      const chaves = new Set(previa.lancamentos.map(chaveDedup));
      const operacoes = [
        // A importação prevalece: remove o que casa com a planilha, manual ou de importação anterior.
        ...existentes
          .filter((e) => chaves.has(chaveDedup(e)))
          .map((e) => ({ apagar: doc(db, "lares", LAR_ID, "lancamentos", e.id) })),
        ...previa.lancamentos.map((l) => ({
          criar: {
            descricao: l.descricao,
            categoria: "Outros",
            cartaoFinal: l.cartaoFinal,
            portador: l.portador,
            valorCentavos: l.valorCentavos,
            dataCompra: l.dataCompra,
            parcela: l.parcela,
            totalParcelas: l.totalParcelas,
            grupoId: `imp|${l.cartaoFinal}|${chaveData(l.dataCompra)}|${l.descricao}|${l.totalParcelas}`,
            faturaFechamento: previa.chaveFatura,
            lancadoPorUid: usuario.uid,
            lancadoPorNome: nomeDoUsuario(usuario),
            origem: "importada",
            criadoEm: new Date(),
          },
        })),
      ];

      // O Firestore aceita até 500 operações por lote; uso 400 por segurança.
      for (let i = 0; i < operacoes.length; i += 400) {
        const lote = writeBatch(db);
        operacoes.slice(i, i + 400).forEach((op) => {
          if (op.apagar) lote.delete(op.apagar);
          else lote.set(doc(refLancamentos()), op.criar);
        });
        await lote.commit();
      }

      previaImportacao = null;
      mostrarAviso(`${previa.lancamentos.length} compras importadas.`, "sucesso");
      abaAtiva = "fatura";
      await renderApp(usuario);
    } catch (e) {
      mostrarAviso(mensagemDeErro(e.code), "erro");
    }
  });
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

// Estado da visão Fatura: forma de exibição (lista ou por semana) e texto da busca.
let modoFatura = (() => {
  try { return localStorage.getItem("milhaPronta.modoFatura") === "semana" ? "semana" : "lista"; }
  catch (e) { return "lista"; }
})();
let buscaFatura = "";
let dadosFatura = null;

function normalizarTexto(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Busca pela descrição (sem acento e sem diferenciar maiúsculas) ou pelo valor exato, como "129,90".
function casaBusca(l, termo) {
  const t = normalizarTexto(termo);
  if (!t) return true;
  if (normalizarTexto(l.descricao).includes(t)) return true;
  const centavos = parseValorBR(termo);
  return Number.isInteger(centavos) && centavos === l.valorCentavos;
}

function dataDeChave(chave) {
  const [ano, mes, dia] = chave.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function itemLancamento(l, comFatura = false) {
  const parcela = l.totalParcelas > 1 ? `parcela ${l.parcela} de ${l.totalParcelas} · ` : "";
  const fatura = comFatura && l.faturaFechamento
    ? ` · fatura que fecha em ${esc(formatarData(dataDeChave(l.faturaFechamento)))}`
    : "";
  return `
    <li class="item">
      <div class="linha">
        <strong>${esc(l.descricao)}</strong>
        <span>${esc(formatarReal(l.valorCentavos))}</span>
      </div>
      <div class="detalhe">${esc(formatarData(l.dataCompra))} · ${esc(parcela)}final ${esc(l.cartaoFinal)} · ${esc(l.portador)} · ${esc(l.categoria)}${fatura}</div>
      <div class="detalhe">lançado por ${esc(l.lancadoPorNome)}
        <button class="link" data-excluir="${esc(l.grupoId)}">excluir compra</button>
      </div>
    </li>`;
}

// Agrupa as compras do ciclo por semana. A semana atual vem primeiro e aberta; as anteriores ficam por último.
function visaoSemanas(ciclo, lancamentos) {
  const semanas = semanasDoCiclo(ciclo.inicio, ciclo.fim).map((s) => ({
    rotulo: `Semana ${s.numero}`,
    intervalo: `${formatarData(s.inicio)} a ${formatarData(s.fim)}`,
    inicio: s.inicio,
    fim: s.fim,
    lista: lancamentos.filter((l) => dentroDe(l.dataCompra, s.inicio, s.fim)),
  }));
  const agora = new Date();
  const ehAtual = (b) => dentroDe(agora, b.inicio, b.fim);
  const noCiclo = (l) => semanas.some((s) => dentroDe(l.dataCompra, s.inicio, s.fim));
  const anteriores = {
    rotulo: "Parcelas de compras anteriores",
    intervalo: "",
    lista: lancamentos.filter((l) => !noCiclo(l)),
  };

  const ordenados = [
    ...semanas.filter(ehAtual),
    ...semanas.filter((b) => !ehAtual(b)),
    ...(anteriores.lista.length ? [anteriores] : []),
  ];

  return ordenados.map((b) => {
    const aberto = b.inicio ? ehAtual(b) : false;
    const corpo = b.lista.length
      ? `<ul class="lista">${b.lista.map((l) => itemLancamento(l)).join("")}</ul>`
      : `<p class="dica">Nenhuma compra nesta semana.</p>`;
    return `
      <details class="cartao semana" ${aberto ? "open" : ""}>
        <summary>
          <span>${esc(b.rotulo)}${aberto ? ' <em class="etiqueta">atual</em>' : ""}</span>
          <span class="semana-total">${esc(formatarReal(somar(b.lista)))}</span>
        </summary>
        <div class="semana-corpo">
          ${b.intervalo ? `<p class="dica">${esc(b.intervalo)}</p>` : ""}
          ${corpo}
        </div>
      </details>`;
  }).join("");
}

// Busca em todas as faturas, com o total encontrado.
function resultadoBusca(termo, todos) {
  const achados = todos
    .filter((l) => casaBusca(l, termo))
    .sort((a, b) => b.dataCompra - a.dataCompra);
  const lista = achados.length
    ? `<ul class="lista">${achados.map((l) => itemLancamento(l, true)).join("")}</ul>`
    : `<p class="dica">Nada encontrado.</p>`;
  return `
    <p class="dica">${achados.length} compra(s) encontrada(s) · total ${esc(formatarReal(somar(achados)))}. A busca cobre todas as faturas.</p>
    ${lista}`;
}

function conteudoFatura(dados) {
  if (buscaFatura.trim()) return resultadoBusca(buscaFatura, dados.todos);
  if (modoFatura === "semana") return visaoSemanas(dados.ciclo, dados.lancamentos);
  return dados.lancamentos.length
    ? `<ul class="lista">${dados.lancamentos.map((l) => itemLancamento(l)).join("")}</ul>`
    : `<p class="dica">Nenhuma compra lançada neste ciclo. Use a aba Lançar para registrar a primeira.</p>`;
}

function telaFatura(dados) {
  const { ciclo, vencimento, total, resumoPorPortador, erroCarga } = dados;
  return `
    <section class="cartao">
      <h2>Ciclo atual</h2>
      <p>Compras feitas hoje entram na fatura que fecha em
        <strong>${esc(formatarData(ciclo.fechamento))}</strong> e vence em
        <strong>${esc(formatarData(vencimento))}</strong>.</p>
      <p><strong>Total lançado nesta fatura:</strong> ${esc(formatarReal(total))}</p>
      <p class="dica">${resumoPorPortador || "Nenhuma compra lançada ainda."}</p>
      ${erroCarga ? `<p class="erro">${esc(erroCarga)}</p>` : ""}
    </section>

    <section class="cartao">
      <h2>Compras</h2>
      <input type="search" id="busca-fatura" placeholder="Buscar por descrição ou valor (ex.: 129,90)" value="${esc(buscaFatura)}" autocomplete="off">
      <div class="seletor-modo" role="group" aria-label="Forma de exibição">
        <button type="button" data-modo="lista" class="${modoFatura === "lista" ? "" : "secundario"}">Lista</button>
        <button type="button" data-modo="semana" class="${modoFatura === "semana" ? "" : "secundario"}">Por semana</button>
      </div>
      <div id="area-fatura">${conteudoFatura(dados)}</div>
    </section>`;
}

// Atualiza só a área de resultados, para o campo de busca não perder o foco a cada letra.
function atualizarAreaFatura() {
  const area = document.getElementById("area-fatura");
  if (area && dadosFatura) area.innerHTML = conteudoFatura(dadosFatura);
  document.querySelectorAll("[data-modo]").forEach((b) => {
    b.classList.toggle("secundario", b.dataset.modo !== modoFatura);
  });
}

function telaReserva(ciclo, lancamentos, reserva) {
  const itensReserva = reserva.itens || {};

  const semanas = semanasDoCiclo(ciclo.inicio, ciclo.fim).map((s) => {
    const compras = lancamentos.filter((l) => dentroDe(l.dataCompra.toDate(), s.inicio, s.fim));
    return {
      chave: `semana-${s.numero}`,
      rotulo: `Semana ${s.numero}`,
      intervalo: `${formatarData(s.inicio)} a ${formatarData(s.fim)}`,
      total: somar(compras),
      inicio: s.inicio,
      fim: s.fim,
    };
  });

  const noCiclo = (l) => semanas.some((s) => dentroDe(l.dataCompra.toDate(), s.inicio, s.fim));
  const anteriores = lancamentos.filter((l) => !noCiclo(l));

  const blocos = [
    ...semanas,
    { chave: "anteriores", rotulo: "Parcelas de compras anteriores", intervalo: "", total: somar(anteriores) },
  ];

  const totalFatura = somar(lancamentos);
  const transferido = blocos
    .filter((b) => itensReserva[b.chave] && itensReserva[b.chave].feito)
    .reduce((soma, b) => soma + b.total, 0);
  const falta = Math.max(totalFatura - transferido, 0);

  // A semana atual vem primeiro e aberta; as demais seguem a ordem de data; as anteriores ficam por último.
  const agora = new Date();
  const ehAtual = (b) => !!b.inicio && dentroDe(agora, b.inicio, b.fim);
  const semanasComuns = blocos.filter((b) => b.chave !== "anteriores");
  const ordenados = [
    ...semanasComuns.filter((b) => ehAtual(b)),
    ...semanasComuns.filter((b) => !ehAtual(b)),
    ...blocos.filter((b) => b.chave === "anteriores"),
  ];

  const cards = ordenados.map((b) => {
    const aberto = ehAtual(b);
    const estado = itensReserva[b.chave] || {};
    const feito = !!estado.feito;
    const mudou = feito && estado.valorCentavos !== b.total;
    const intervalo = b.intervalo ? `<p class="dica">${esc(b.intervalo)}</p>` : "";
    const situacao = feito
      ? `<p class="dica">Transferido por ${esc(estado.feitoPorNome)}</p>`
      : "";
    const aviso = mudou
      ? `<p class="aviso-leve">O valor mudou desde a transferência (era ${esc(formatarReal(estado.valorCentavos))}). Confira o que foi reservado.</p>`
      : "";
    const acao = b.total > 0
      ? `<button class="${feito ? "secundario" : ""}" data-reserva="${esc(b.chave)}" data-marcar="${feito ? "0" : "1"}" data-valor="${b.total}">${feito ? "Desmarcar" : "Marcar como transferido"}</button>`
      : `<p class="dica">Nada a transferir nesta parte.</p>`;
    return `
      <details class="cartao semana" ${aberto ? "open" : ""}>
        <summary>
          <span>${esc(b.rotulo)}${aberto ? ' <em class="etiqueta">atual</em>' : ""}</span>
          <span class="semana-total">${esc(formatarReal(b.total))}</span>
        </summary>
        <div class="semana-corpo">
          ${intervalo}
          ${situacao}
          ${aviso}
          ${acao}
        </div>
      </details>`;
  }).join("");

  const real = reserva.valorFaturaReal;
  let comparacao = "";
  if (real != null) {
    const diferenca = real - totalFatura;
    if (diferenca === 0) comparacao = "Bate com o total lançado.";
    else if (diferenca > 0) comparacao = `Faltou lançar ou reservar ${esc(formatarReal(diferenca))}.`;
    else comparacao = `Sobrou ${esc(formatarReal(-diferenca))} em relação ao total lançado.`;
  }

  return `
    <section class="stats">
      <div class="stat stat-total">
        <span class="stat-rotulo">Total da fatura</span>
        <span class="stat-valor">${esc(formatarReal(totalFatura))}</span>
      </div>
      <div class="stat stat-transferido">
        <span class="stat-rotulo">Já transferido</span>
        <span class="stat-valor">${esc(formatarReal(transferido))}</span>
      </div>
      <div class="stat stat-falta">
        <span class="stat-rotulo">Falta transferir</span>
        <span class="stat-valor">${esc(formatarReal(falta))}</span>
      </div>
    </section>
    <p class="dica">Fecha em ${esc(formatarData(ciclo.fechamento))}. Compras de ${esc(formatarData(ciclo.inicio))} a ${esc(formatarData(ciclo.fim))}.</p>

    ${cards}

    <section class="cartao">
      <h2>Fatura fechada</h2>
      <form id="form-valor-real">
        <label>Valor real da fatura (R$)
          <input name="valorReal" inputmode="decimal" placeholder="0,00"
            value="${real != null ? esc((real / 100).toFixed(2).replace(".", ",")) : ""}">
        </label>
        <button type="submit">${real != null ? "Atualizar valor" : "Salvar valor"}</button>
        ${real != null ? `<button type="button" class="secundario" data-acao="remover-valor-real">Remover valor</button>` : ""}
        <p class="erro" id="erro-valor-real"></p>
      </form>
      ${real != null ? `<p>Valor salvo: <strong>${esc(formatarReal(real))}</strong></p>` : ""}
      ${comparacao ? `<p class="dica">${comparacao}</p>` : ""}
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

function blocoImportar() {
  if (!previaImportacao) {
    return `
      <section class="cartao">
        <h2>Importar fatura do Itaú</h2>
        <p class="dica">Escolha a planilha "Fatura Aberta" exportada do Itaú (.xlsx). Nada é gravado antes da prévia.</p>
        <input type="file" id="arquivo-fatura" accept=".xlsx">
        <button type="button" id="btn-ver-previa">Ver prévia</button>
        <p class="erro" id="erro-importacao"></p>
      </section>`;
  }

  const p = previaImportacao;
  const confere = (ok, sim, nao) => `<span class="${ok ? "ok" : "erro"}">${ok ? sim : nao}</span>`;
  const itens = p.lancamentos.map((l) => `
    <li class="item">
      <div class="linha">
        <strong>${esc(l.descricao)}</strong>
        <span>${esc(formatarReal(l.valorCentavos))}</span>
      </div>
      <div class="detalhe">${esc(formatarData(l.dataCompra))} · ${esc(l.portador)} · final ${esc(l.cartaoFinal)}${l.totalParcelas > 1 ? ` · parcela ${l.parcela} de ${l.totalParcelas}` : ""}</div>
    </li>`).join("");
  const ignorados = p.ignorados.map((i) => `${esc(formatarData(i.dataCompra))} · ${esc(formatarReal(i.valorCentavos))} (${esc(i.motivo)})`).join("<br>");

  return `
    <section class="cartao">
      <h2>Prévia da importação</h2>
      <p>Fecha em <strong>${esc(formatarData(p.fechamento))}</strong>. Vence em <strong>${esc(formatarData(p.vencimento))}</strong>
        ${confere(p.vencimentoConfere, "(bate com a planilha)", `(a planilha diz ${esc(formatarData(p.vencimentoArquivo))})`)}</p>
      <p>Total das compras: <strong>${esc(formatarReal(p.totalImportado))}</strong>
        ${confere(p.totalConfere, "(bate com o cabeçalho)", `(cabeçalho: ${esc(formatarReal(p.totalArquivo))})`)}</p>
      <p>Compras a importar: <strong>${p.lancamentos.length}</strong>.
        Lançamentos existentes que serão substituídos: <strong>${p.substituindo}</strong>.</p>
      ${ignorados ? `<p class="dica">Ignorados: ${ignorados}</p>` : ""}
      <div class="acoes">
        <button type="button" id="btn-importar">Importar ${p.lancamentos.length} compras</button>
        <button type="button" class="secundario" id="btn-cancelar-previa">Cancelar</button>
      </div>
    </section>

    <section class="cartao">
      <ul class="lista">${itens}</ul>
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

    ${blocoImportar()}

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
  const versao = ++versaoRender;
  usuarioAtual = usuario;
  const hoje = new Date();
  const ciclo = calcularCiclo(hoje);
  const vencimento = vencimentoDaFatura(ciclo.fechamento, lar.diaVencimento);

  let lancamentos = [];
  let todos = [];
  let reserva = {};
  let erroCarga = "";
  try {
    if (abaAtiva === "fatura") {
      todos = await carregarTodosLancamentos();
      lancamentos = todos
        .filter((l) => l.faturaFechamento === ciclo.chave)
        .sort((a, b) => b.dataCompra - a.dataCompra);
    } else {
      lancamentos = await carregarFatura(ciclo.chave);
      reserva = await carregarReserva(ciclo.chave);
    }
  } catch (e) {
    erroCarga = mensagemDeErro(e.code);
  }

  const total = somar(lancamentos);
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
  if (abaAtiva === "reserva") {
    conteudo = telaReserva(ciclo, lancamentos, reserva);
  } else if (abaAtiva === "lancar") {
    conteudo = telaLancar(hoje, opcoesCartao, opcoesPortador, opcoesCategoria);
  } else if (abaAtiva === "ajustes") {
    conteudo = telaAjustes(cartoes);
  } else {
    dadosFatura = { ciclo, vencimento, lancamentos, todos, total, resumoPorPortador, erroCarga };
    conteudo = telaFatura(dadosFatura);
  }

  if (versao !== versaoRender || usuarioAtual !== usuario) return;
  raiz.innerHTML = `
    <header class="topo">
      <span>${esc(nomeDoUsuario(usuario))}</span>
    </header>
    ${conteudo}
    ${barraInferior()}`;

  const btnSairBarra = raiz.querySelector("[data-acao='sair']");
  if (btnSairBarra) {
    btnSairBarra.addEventListener("click", sair);
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

  const campoBusca = document.getElementById("busca-fatura");
  if (campoBusca) {
    campoBusca.addEventListener("input", (evento) => {
      buscaFatura = evento.target.value;
      atualizarAreaFatura();
    });
  }

  raiz.querySelectorAll("[data-reserva]").forEach((botao) => {
    botao.addEventListener("click", async () => {
      const marcar = botao.dataset.marcar === "1";
      await comCarregamento(botao, "Salvando…", async () => {
        try {
          await salvarTransferencia(ciclo.chave, botao.dataset.reserva, Number(botao.dataset.valor), marcar, usuario);
          mostrarAviso(marcar ? "Transferência marcada." : "Marcação removida.", "sucesso");
          await renderApp(usuario);
        } catch (e) {
          mostrarAviso(mensagemDeErro(e.code), "erro");
        }
      });
    });
  });

  const formValorReal = document.getElementById("form-valor-real");
  if (formValorReal) {
    formValorReal.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const form = evento.target;
      const botao = evento.submitter || form.querySelector("button[type=submit]");
      const erro = document.getElementById("erro-valor-real");
      erro.textContent = "";
      const valor = parseValorBR(form.valorReal.value);
      if (!Number.isInteger(valor) || valor <= 0) {
        erro.textContent = "Informe um valor válido, por exemplo 9547,79.";
        return;
      }
      await comCarregamento(botao, "Salvando…", async () => {
        try {
          await setDoc(doc(db, "lares", LAR_ID, "reservas", ciclo.chave), { valorFaturaReal: valor }, { merge: true });
          mostrarAviso("Valor da fatura salvo.", "sucesso");
          await renderApp(usuario);
        } catch (e) {
          const msg = mensagemDeErro(e.code);
          erro.textContent = msg;
          mostrarAviso(msg, "erro");
        }
      });
    });
  }

  const btnVerPrevia = document.getElementById("btn-ver-previa");
  if (btnVerPrevia) {
    btnVerPrevia.addEventListener("click", () => verPreviaImportacao(usuario, btnVerPrevia));
  }
  const btnImportar = document.getElementById("btn-importar");
  if (btnImportar) {
    btnImportar.addEventListener("click", () => confirmarImportacao(usuario, btnImportar));
  }
  const btnCancelarPrevia = document.getElementById("btn-cancelar-previa");
  if (btnCancelarPrevia) {
    btnCancelarPrevia.addEventListener("click", async () => {
      previaImportacao = null;
      await renderApp(usuario);
    });
  }

  const btnRemoverReal = raiz.querySelector("[data-acao='remover-valor-real']");
  if (btnRemoverReal) {
    btnRemoverReal.addEventListener("click", async () => {
      if (!confirm("Remover o valor real informado para esta fatura?")) return;
      await comCarregamento(btnRemoverReal, "Removendo…", async () => {
        try {
          await setDoc(doc(db, "lares", LAR_ID, "reservas", ciclo.chave),
            { valorFaturaReal: deleteField() }, { merge: true });
          mostrarAviso("Valor da fatura removido.", "sucesso");
          await renderApp(usuario);
        } catch (e) {
          mostrarAviso(mensagemDeErro(e.code), "erro");
        }
      });
    });
  }

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
    sair();
  });
}

// --- Inicialização -------------------------------------------------------

// Cliques da Fatura e exclusão ficam num único ouvinte no topo da tela,
// assim continuam funcionando mesmo depois que a área é redesenhada.
raiz.addEventListener("click", async (evento) => {
  const modo = evento.target.closest("[data-modo]");
  if (modo) {
    modoFatura = modo.dataset.modo;
    try { localStorage.setItem("milhaPronta.modoFatura", modoFatura); } catch (e) { /* sem armazenamento: segue sem lembrar */ }
    atualizarAreaFatura();
    return;
  }

  const botao = evento.target.closest("[data-excluir]");
  if (botao && usuarioAtual) {
    if (!confirm("Excluir esta compra? Se for parcelada, todas as parcelas serão removidas.")) return;
    await comCarregamento(botao, "Excluindo…", async () => {
      try {
        await excluirGrupo(botao.dataset.excluir);
        mostrarAviso("Compra excluída.", "sucesso");
        await renderApp(usuarioAtual);
      } catch (e) {
        mostrarAviso(mensagemDeErro(e.code), "erro");
      }
    });
  }
});

window.addEventListener("beforeinstallprompt", (evento) => {
  evento.preventDefault();
  instalacaoDisponivel = evento;
});

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    usuarioAtual = null;
    lar = null;
    renderLogin();
    return;
  }
  try {
    lar = await garantirLar();
    if (usuarioAtual !== null && usuarioAtual.uid !== usuario.uid) return;
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
