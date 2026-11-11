// Leitura da planilha "Fatura Aberta" do Itaú (.xlsx), sem bibliotecas externas.
// Um .xlsx é um arquivo ZIP com XML dentro. Os navegadores modernos já sabem
// descomprimir "deflate-raw" (DecompressionStream), então lemos o ZIP aqui mesmo.

// ---------------------------------------------------------------------------
// 1. ZIP
// ---------------------------------------------------------------------------

async function descomprimir(dados) {
  const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

// Retorna um Map: caminho do arquivo dentro do ZIP -> bytes.
async function lerZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Acha o "fim do diretório central", que fica no final do arquivo.
  let fim = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error("Este arquivo não parece ser uma planilha .xlsx.");

  const total = view.getUint16(fim + 10, true);
  let posicao = view.getUint32(fim + 16, true);
  const decoder = new TextDecoder();
  const arquivos = new Map();

  for (let n = 0; n < total; n++) {
    if (view.getUint32(posicao, true) !== 0x02014b50) {
      throw new Error("Estrutura da planilha inválida.");
    }
    const metodo = view.getUint16(posicao + 10, true);
    const tamanhoCompactado = view.getUint32(posicao + 20, true);
    const tamanhoNome = view.getUint16(posicao + 28, true);
    const tamanhoExtra = view.getUint16(posicao + 30, true);
    const tamanhoComentario = view.getUint16(posicao + 32, true);
    const posicaoLocal = view.getUint32(posicao + 42, true);
    const nome = decoder.decode(bytes.subarray(posicao + 46, posicao + 46 + tamanhoNome));
    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;

    // Cabeçalho local: aqui os tamanhos de nome e extra podem diferir do diretório central.
    const nomeLocal = view.getUint16(posicaoLocal + 26, true);
    const extraLocal = view.getUint16(posicaoLocal + 28, true);
    const inicio = posicaoLocal + 30 + nomeLocal + extraLocal;
    const dados = bytes.subarray(inicio, inicio + tamanhoCompactado);

    arquivos.set(nome, metodo === 0 ? dados : await descomprimir(dados));
  }
  return arquivos;
}

// ---------------------------------------------------------------------------
// 2. Células da planilha
// ---------------------------------------------------------------------------

function decodificarXml(texto) {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function textosDe(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => decodificarXml(m[1]))
    .join("");
}

// Retorna um Map: "B10" -> valor (texto, número ou null).
function lerCelulas(arquivos) {
  const decoder = new TextDecoder();
  const xmlCompartilhadas = arquivos.get("xl/sharedStrings.xml");
  const compartilhadas = xmlCompartilhadas
    ? [...decoder.decode(xmlCompartilhadas).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textosDe(m[1]))
    : [];

  // Usa a primeira aba da pasta de planilhas.
  const nomeAba = [...arquivos.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!nomeAba) throw new Error("Não encontrei nenhuma aba na planilha.");

  const xml = decoder.decode(arquivos.get(nomeAba));
  const celulas = new Map();
  const regexCelula = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  for (const [, ref, atributos, conteudo = ""] of xml.matchAll(regexCelula)) {
    const tipo = (atributos.match(/t="([^"]+)"/) || [])[1];
    const v = (conteudo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    let valor = null;
    if (tipo === "s") valor = v !== undefined ? compartilhadas[Number(v)] ?? null : null;
    else if (tipo === "inlineStr") valor = textosDe(conteudo);
    else if (tipo === "str") valor = v !== undefined ? decodificarXml(v) : null;
    else if (v !== undefined) valor = Number(v);
    celulas.set(ref, valor);
  }
  return celulas;
}

function separarRef(ref) {
  const [, coluna, linha] = ref.match(/^([A-Z]+)(\d+)$/);
  return { coluna, linha: Number(linha) };
}

// Número de série do Excel -> Date no dia local (sem deslocamento de fuso).
function serialParaData(serial) {
  const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

function textoLimpo(valor) {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// 3. Extração da fatura
// ---------------------------------------------------------------------------

// Lê a fatura a partir das células. Não aplica regra de negócio:
// só separa compras (valores positivos) de pagamentos e estornos (negativos).
function extrairFatura(celulas) {
  // Procura um rótulo e devolve o valor logo abaixo dele.
  const valorAbaixoDe = (rotulo) => {
    for (const [ref, valor] of celulas) {
      if (valor === rotulo) {
        const { coluna, linha } = separarRef(ref);
        return celulas.get(`${coluna}${linha + 1}`) ?? null;
      }
    }
    return null;
  };

  // A linha de cabeçalho é a que tem "Lançamento" na lista de colunas.
  let linhaCabecalho = null;
  for (const [ref, valor] of celulas) {
    if (valor === "Lançamento") { linhaCabecalho = separarRef(ref).linha; break; }
  }
  if (!linhaCabecalho) throw new Error("Não encontrei a tabela de lançamentos na planilha.");

  const colunas = {};
  for (const [ref, valor] of celulas) {
    const { coluna, linha } = separarRef(ref);
    if (linha === linhaCabecalho && typeof valor === "string") colunas[valor.trim()] = coluna;
  }
  const obrigatorias = ["Data", "Lançamento", "Valor", "Titularidade", "Nome", "Número do cartão"];
  const faltando = obrigatorias.filter((c) => !colunas[c]);
  if (faltando.length) {
    throw new Error(`Esta planilha não tem as colunas esperadas: ${faltando.join(", ")}.`);
  }

  const linhas = [...celulas.keys()].map((r) => separarRef(r).linha);
  const ultimaLinha = Math.max(...linhas);

  const lancamentos = [];
  const ignorados = [];

  for (let linha = linhaCabecalho + 1; linha <= ultimaLinha; linha++) {
    const dataSerial = celulas.get(`${colunas["Data"]}${linha}`);
    const valor = celulas.get(`${colunas["Valor"]}${linha}`);
    if (typeof dataSerial !== "number" || typeof valor !== "number") continue;

    const descricao = textoLimpo(celulas.get(`${colunas["Lançamento"]}${linha}`));
    const dataCompra = serialParaData(dataSerial);
    const parcelamento = textoLimpo(celulas.get(`${colunas["Parcelamento"]}${linha}`));
    const nome = textoLimpo(celulas.get(`${colunas["Nome"]}${linha}`));
    const numeroCartao = textoLimpo(celulas.get(`${colunas["Número do cartão"]}${linha}`));
    const cartaoFinal = numeroCartao.replace(/\D/g, "").slice(-4);
    const parcela = parcelamento.match(/Parcela\s+(\d+)\s+de\s+(\d+)/i);

    const item = {
      descricao,
      dataCompra,
      valorCentavos: Math.round(valor * 100),
      cartaoFinal,
      portador: /cibele/i.test(nome) ? "Cibele" : "Mário",
      parcela: parcela ? Number(parcela[1]) : 1,
      totalParcelas: parcela ? Number(parcela[2]) : 1,
      nomeNaFatura: nome,
      linha,
    };

    if (valor <= 0) {
      ignorados.push({ ...item, motivo: "pagamento ou estorno" });
    } else {
      lancamentos.push(item);
    }
  }

  const vencimentoSerial = valorAbaixoDe("Vencimento");
  const valorParcial = valorAbaixoDe("Valor (parcial)");

  return {
    vencimento: typeof vencimentoSerial === "number" ? serialParaData(vencimentoSerial) : null,
    valorParcialCentavos: typeof valorParcial === "number" ? Math.round(valorParcial * 100) : null,
    lancamentos,
    ignorados,
  };
}

// Ponto de entrada: recebe o conteúdo do arquivo (ArrayBuffer).
export async function lerFatura(buffer) {
  const arquivos = await lerZip(buffer);
  const celulas = lerCelulas(arquivos);
  return extrairFatura(celulas);
}
