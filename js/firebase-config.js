// Configuração do projeto Firebase (plano Spark, gratuito).
// Substitua os valores "SUBSTITUIR" pelos dados do seu projeto (Configurações do projeto > Seus apps > Configuração do SDK).
// Estes valores não são segredos: a segurança vem das regras do Firestore (firestore.rules).
export const firebaseConfig = {
  apiKey: "AIzaSyCZk7oAR2ZsIeZIT2eWUgku3t8sNULXnOM",
  authDomain: "milha-pronta.firebaseapp.com",
  projectId: "milha-pronta",
  storageBucket: "milha-pronta.firebasestorage.app",
  messagingSenderId: "339577945242",
  appId: "1:339577945242:web:94d16cd28bd4890cee3323",
};

// Identificador do "lar" compartilhado entre você e sua esposa. Deve bater com firestore.rules.
export const LAR_ID = "principal";

// Valores iniciais criados na primeira vez. Podem ser editados depois na tela de configuração.
export const DEFAULTS = {
  diaFechamento: 28,
  diaVencimento: 6,
  cartoes: [
    { final: "2262", tipo: "Virtual recorrente" },
    { final: "3773", tipo: "Físico" },
    { final: "6071", tipo: "Físico" },
    { final: "7180", tipo: "Virtual recorrente" },
    { final: "7402", tipo: "Físico" },
    { final: "9802", tipo: "Virtual recorrente" },
  ],
};

// Participantes do lar: UID do Firebase -> nome exibido no app.
export const PARTICIPANTES = {
  "6M2CXKUi8ASLma5AkqEeZiC3S282": "Mário",
  "J5afWl6yW5Syg3mhg1NtBz48qif2": "Cibele",
};

export const CATEGORIAS = [
  "Alimentação", "Transporte", "Assinaturas", "Saúde", "Educação",
  "Casa", "Lazer", "Compras", "Serviços", "Outros",
];
