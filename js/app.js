import { firebaseConfig, LAR_ID, DEFAULTS } from "./firebase-config.js";
import {
  fechamentoDaCompra,
  vencimentoDaFatura,
  formatarData,
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
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebase = initializeApp(firebaseConfig);
const auth = getAuth(firebase);
const db = initializeFirestore(firebase, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const raiz = document.getElementById("app");
let instalacaoDisponivel = null;
let lar = null;

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
  };
  return mapa[codigo] || "Algo deu errado. Tente novamente.";
}

function ehIphoneSemInstalar() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
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
    const email = form.email.value.trim();
    const senha = form.senha.value;
    const acao = evento.submitter.value;
    const erro = document.getElementById("erro");
    erro.textContent = "";
    try {
      if (acao === "criar") {
        await createUserWithEmailAndPassword(auth, email, senha);
      } else {
        await signInWithEmailAndPassword(auth, email, senha);
      }
    } catch (e) {
      erro.textContent = mensagemDeErro(e.code);
    }
  });
}

async function garantirLar() {
  const ref = doc(db, "lares", LAR_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...DEFAULTS, criadoEm: new Date() });
    return { ...DEFAULTS };
  }
  return snap.data();
}

function blocoCicloAtual() {
  const hoje = new Date();
  const fechamento = fechamentoDaCompra(hoje, lar.diaFechamento);
  const vencimento = vencimentoDaFatura(fechamento, lar.diaVencimento);
  return `
    <section class="cartao">
      <h2>Ciclo atual</h2>
      <p>Compras feitas hoje entram na fatura que fecha em
        <strong>${esc(formatarData(fechamento))}</strong> e vence em
        <strong>${esc(formatarData(vencimento))}</strong>.</p>
      <p class="dica">O vencimento cai em dia útil. Se o dia 6 cair em fim de semana, passa para o próximo dia útil.</p>
    </section>`;
}

function blocoCartoes() {
  const itens = lar.cartoes
    .map((c) => `<li>final ${esc(c.final)} · ${esc(c.tipo)}</li>`)
    .join("");
  return `
    <section class="cartao">
      <h2>Cartões</h2>
      <ul>${itens}</ul>
    </section>`;
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

function renderApp(usuario) {
  raiz.innerHTML = `
    <header class="topo">
      <span>${esc(usuario.email)}</span>
      <button id="btn-sair" class="secundario">Sair</button>
    </header>
    ${blocoCicloAtual()}
    ${blocoCartoes()}
    <section class="cartao">
      <h2>Configuração do ciclo</h2>
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

  document.getElementById("btn-sair").addEventListener("click", () => signOut(auth));

  document.getElementById("form-config").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const form = evento.target;
    const diaFechamento = Number(form.diaFechamento.value);
    const diaVencimento = Number(form.diaVencimento.value);
    const erro = document.getElementById("erro-config");
    if (!Number.isInteger(diaFechamento) || diaFechamento < 1 || diaFechamento > 28 ||
        !Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 28) {
      erro.textContent = "Use dias entre 1 e 28.";
      return;
    }
    try {
      await updateDoc(doc(db, "lares", LAR_ID), { diaFechamento, diaVencimento });
      lar = { ...lar, diaFechamento, diaVencimento };
      renderApp(usuario);
    } catch (e) {
      erro.textContent = mensagemDeErro(e.code);
    }
  });

  const btnInstalar = document.getElementById("btn-instalar");
  if (btnInstalar) {
    btnInstalar.addEventListener("click", async () => {
      instalacaoDisponivel.prompt();
      await instalacaoDisponivel.userChoice;
      instalacaoDisponivel = null;
      renderApp(usuario);
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
  document.getElementById("btn-sair").addEventListener("click", () => signOut(auth));
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
    renderApp(usuario);
  } catch (e) {
    renderSemAcesso(mensagemDeErro(e.code));
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
