# Milha Pronta (PWA)

App pessoal para registrar compras no cartão, revisar por ciclo e reservar o valor da fatura.
Não tem build: são arquivos HTML, CSS e JavaScript puros, com Firebase (plano Spark, gratuito) para login e dados.

## Estrutura

```
index.html            tela principal
styles.css            estilos
manifest.json         instalação como app (iPhone e Windows)
sw.js                 cache do casco para abrir sem internet
firestore.rules       regras de acesso aos dados (aplicadas no painel do Firebase)
js/app.js             login, telas, configuração do ciclo
js/dominio.js         regras puras: fechamento, vencimento, centavos
js/firebase-config.js configuração do projeto e valores iniciais
icons/                ícones do app
```

## Passo a passo (fazer uma vez)

### 1. Criar o projeto no Firebase (gratuito)
1. Acesse console.firebase.google.com e crie um projeto (ex.: `gastos-cartao`). Plano Spark, sem cartão.
2. Em **Criar > Authentication > Método de login**, ative **E-mail/senha**.
3. Em **Criar > Firestore Database**, crie o banco no modo de produção, na região `southamerica-east1`. A região não pode ser mudada depois.
4. Em **Configurações do projeto > Seus apps**, adicione um app da Web (ícone `</>`) e copie o objeto `firebaseConfig`.
5. Cole os valores em `js/firebase-config.js`, no lugar de `SUBSTITUIR`.

### 2. Criar as duas contas
1. Abra o app (depois de publicado, passo 4) e toque em **Criar conta** com o seu e-mail.
2. Faça o mesmo com o e-mail da sua esposa.
3. Em **Authentication > Usuários**, copie os dois UIDs.
4. Em `firestore.rules`, substitua `SUBSTITUIR_UID_MARIO` e `SUBSTITUIR_UID_CIBELE` pelos UIDs.
5. No console do Firebase, em **Firestore > Regras**, cole o conteúdo do arquivo e publique.

### 3. Testar localmente (opcional)
Abra a pasta com um servidor local simples, por exemplo `python3 -m http.server 8000`, e acesse `http://localhost:8000`.
Para o login funcionar, o domínio precisa estar em **Authentication > Configurações > Domínios autorizados**. O `localhost` já vem autorizado.

### 4. Publicar no GitHub Pages (gratuito)
1. Crie um repositório **público** no GitHub. Não coloque dados reais nele.
2. Envie os arquivos deste projeto.
3. Em **Settings > Pages**, escolha a branch `main` e a pasta raiz.
4. O endereço fica `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.
5. Em **Authentication > Configurações > Domínios autorizados**, adicione `SEU-USUARIO.github.io`.

### 5. Instalar nos aparelhos
- **iPhone:** abra o endereço no Safari, toque em Compartilhar e depois em **Adicionar à Tela de Início**.
- **Windows:** abra o endereço no Chrome ou no Edge e clique no ícone de instalar na barra de endereço.

## Manutenção
- Ao alterar qualquer arquivo local, troque `VERSAO` em `sw.js` (ex.: `gastos-cartao-v2`). Sem isso, o aparelho continua com a versão antiga.
- A biblioteca do Firebase é carregada pela internet. Sem conexão, o app abre, mas o login e os dados só funcionam quando a internet voltar.
- Os limites gratuitos do Firebase Spark podem mudar. Confira em firebase.google.com/pricing de tempos em tempos.
- A versão do SDK (`10.14.1`) está fixada nos imports de `js/app.js`. Para atualizar, troque o número nos três imports.
