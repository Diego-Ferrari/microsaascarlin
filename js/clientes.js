
const form = document.querySelector("#client-form");
const modal = document.querySelector("#client-modal");
const clientList = document.querySelector("#client-list");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#client-search");
const filterSelect = document.querySelector("#client-filter");
const historyModal = document.querySelector("#history-modal");
const historyContent = document.querySelector("#history-content");

let clients = [];
let editingId = null;

// Todos os campos cadastrados na tabela clientes.
const camposCliente = [
  "nome",
  "tipo",
  "documento",
  "telefone",
  "whatsapp",
  "email",
  "data_nascimento",
  "endereco",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado",
  "cep",
  "observacoes"
];

function mostrarErro(mensagem) {
  console.error(mensagem);
  alert(mensagem);
}

function normalizarCliente(cliente) {
  return {
    id: cliente.id,
    nome: cliente.nome ?? "",
    tipo: cliente.tipo ?? "Pessoa física",
    documento: cliente.documento ?? "",
    telefone: cliente.telefone ?? "",
    whatsapp: cliente.whatsapp ?? "",
    email: cliente.email ?? "",
    data_nascimento: cliente.data_nascimento ?? "",
    endereco: cliente.endereco ?? "",
    numero: cliente.numero ?? "",
    complemento: cliente.complemento ?? "",
    bairro: cliente.bairro ?? "",
    cidade: cliente.cidade ?? "",
    estado: cliente.estado ?? "",
    cep: cliente.cep ?? "",
    observacoes: cliente.observacoes ?? "",
    arquivado_em: cliente.arquivado_em ?? null
  };
}

function clienteEstaArquivado(cliente) {
  return cliente.arquivado_em !== null;
}

function abrirModal(cliente = null) {
  editingId = cliente?.id ?? null;
  form.reset();

  if (cliente) {
    camposCliente.forEach((campo) => {
      if (form.elements[campo]) {
        form.elements[campo].value = cliente[campo] ?? "";
      }
    });

    document.querySelector("#modal-title").textContent =
      "Editar cliente";

    form.querySelector('[type="submit"]').textContent =
      "Salvar alterações";
  } else {
    document.querySelector("#modal-title").textContent =
      "Novo cliente";

    form.querySelector('[type="submit"]').textContent =
      "Salvar cliente";
  }

  modal.hidden = false;
  document.body.style.overflow = "hidden";
  form.elements.nome.focus();
}

function fecharModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
  editingId = null;
}

document
  .querySelector("#new-client")
  .addEventListener("click", () => abrirModal());

document
  .querySelector("#empty-new-client")
  .addEventListener("click", () => abrirModal());

document
  .querySelector("#close-modal")
  .addEventListener("click", fecharModal);

document
  .querySelector("#cancel-modal")
  .addEventListener("click", fecharModal);

modal.addEventListener("click", (event) => {
  if (event.target === modal) fecharModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) {
    fecharModal();
  }
});

document
  .querySelector("#close-history-modal")
  .addEventListener("click", fecharHistorico);

document
  .querySelector("#cancel-history-modal")
  .addEventListener("click", fecharHistorico);

historyModal.addEventListener("click", (event) => {
  if (event.target === historyModal) {
    fecharHistorico();
  }
});


function criarElemento(tag, classe, texto = "") {
  const elemento = document.createElement(tag);

  if (classe) elemento.className = classe;
  if (texto) elemento.textContent = texto;

  return elemento;
}

function formatarData(data) {
  if (!data) return "Data não informada";

  const [ano, mes, dia] = data.split("-");

  return `${dia}/${mes}/${ano}`;
}

function formatarQuantidade(quantidade) {
  return Number(quantidade).toLocaleString("pt-BR");
}

function nomeOrigem(origem) {
  const origens = {
    historico_manual: "Histórico manual",
    orcamento: "Orçamento",
    avulso: "Serviço avulso"
  };

  return origens[origem] ?? "Atendimento";
}

async function carregarHistorico(cliente) {
  historyContent.replaceChildren(
    criarElemento(
      "p",
      "history-loading",
      "Carregando histórico..."
    )
  );

  try {
    // 1. Busca os atendimentos do cliente.
    const { data: execucoes, error: erroExecucoes } =
      await supabaseClient
        .from("execucoes_servico")
        .select(`
          id,
          data_execucao,
          origem,
          observacoes
        `)
        .eq("cliente_id", cliente.id)
        .order("data_execucao", { ascending: false });

    if (erroExecucoes) throw erroExecucoes;

    const atendimentos = execucoes ?? [];

    // 2. Busca os serviços de todos os atendimentos.
    let itens = [];

    if (atendimentos.length > 0) {
      const idsExecucoes = atendimentos.map(
        (execucao) => execucao.id
      );

      const { data, error } = await supabaseClient
        .from("itens_execucao")
        .select(`
          execucao_id,
          descricao,
          quantidade,
          preco_unitario
        `)
        .in("execucao_id", idsExecucoes)
        .order("criado_em", { ascending: true });

      if (error) throw error;

      itens = data ?? [];
    }

    // 3. Agrupa os itens pelo atendimento.
    const itensPorExecucao = new Map();

    itens.forEach((item) => {
      if (!itensPorExecucao.has(item.execucao_id)) {
        itensPorExecucao.set(item.execucao_id, []);
      }

      itensPorExecucao.get(item.execucao_id).push(item);
    });

    // 4. Monta a interface.
    renderHistorico(cliente, atendimentos, itensPorExecucao);

  } catch (error) {
    console.error("Erro ao carregar histórico:", error);

    historyContent.replaceChildren(
      criarElemento(
        "div",
        "history-empty",
        "Não foi possível carregar o histórico deste cliente."
      )
    );
  }
}


function renderHistorico(cliente, atendimentos, itensPorExecucao) {
  historyContent.replaceChildren();

  const formatarMoeda = (valor) =>
    Number(valor).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

  // Informações do cliente.
  const clienteInfo = criarElemento("div", "history-client-info");

  const avatar = criarElemento(
    "div",
    "history-client-avatar",
    cliente.nome.charAt(0).toUpperCase()
  );

  const identificacao = document.createElement("div");

  identificacao.append(
    criarElemento("h3", "", cliente.nome),
    criarElemento(
      "p",
      "",
      cliente.telefone || cliente.email || "Sem contato cadastrado"
    )
  );

  clienteInfo.append(avatar, identificacao);
  historyContent.append(clienteInfo);

  // Calcula os totais gerais.
  let totalUnidades = 0;
  let totalGeral = 0;

  atendimentos.forEach((atendimento) => {
    const itens = itensPorExecucao.get(atendimento.id) ?? [];

    itens.forEach((item) => {
      const quantidade = Number(item.quantidade);
      const precoUnitario = Number(item.preco_unitario);

      totalUnidades += quantidade;
      totalGeral += quantidade * precoUnitario;
    });
  });

  // Estatísticas gerais.
  const stats = criarElemento("div", "history-stats");

  const statAtendimentos = criarElemento("div", "history-stat");
  statAtendimentos.append(
    criarElemento("span", "", "Atendimentos"),
    criarElemento("strong", "", String(atendimentos.length))
  );

  const statServicos = criarElemento("div", "history-stat");
  statServicos.append(
    criarElemento("span", "", "Unidades realizadas"),
    criarElemento("strong", "", formatarQuantidade(totalUnidades))
  );

  stats.append(statAtendimentos, statServicos);
  historyContent.append(stats);

  // Histórico vazio.
  if (atendimentos.length === 0) {
    const vazio = criarElemento("div", "history-empty");

    vazio.append(
      criarElemento("strong", "", "Nenhum atendimento registrado"),
      criarElemento(
        "p",
        "",
        "Os serviços realizados para este cliente aparecerão aqui."
      )
    );

    historyContent.append(vazio);
    return;
  }

  historyContent.append(
    criarElemento(
      "h3",
      "history-section-title",
      "Atendimentos realizados"
    )
  );

  const timeline = criarElemento("div", "history-timeline");

  atendimentos.forEach((atendimento) => {
    const card = criarElemento("article", "history-item");

    const servicos = itensPorExecucao.get(atendimento.id) ?? [];

    // Cabeçalho do atendimento.
    const cabecalho = criarElemento(
      "div",
      "history-item-header"
    );

    cabecalho.append(
      criarElemento(
        "span",
        "history-item-date",
        formatarData(atendimento.data_execucao)
      ),
      criarElemento(
        "span",
        "history-item-type",
        nomeOrigem(atendimento.origem)
      )
    );

    card.append(cabecalho);

    // Lista de serviços.
    const listaServicos = criarElemento(
      "div",
      "history-service-list"
    );

    let subtotalQuantidade = 0;
    let subtotalValor = 0;

    if (servicos.length === 0) {
      listaServicos.append(
        criarElemento(
          "p",
          "history-loading",
          "Nenhum item registrado neste atendimento."
        )
      );
    } else {
      servicos.forEach((servico) => {
        const quantidade = Number(servico.quantidade);
        const precoUnitario = Number(servico.preco_unitario);
        const subtotalServico = quantidade * precoUnitario;

        subtotalQuantidade += quantidade;
        subtotalValor += subtotalServico;

        const linha = criarElemento("div", "history-service");

        const descricao = document.createElement("div");
        descricao.className = "history-service-description";

        descricao.append(
          criarElemento("strong", "", servico.descricao),
          criarElemento(
            "small",
            "",
            `${formatarMoeda(precoUnitario)} por unidade`
          )
        );

        const valores = criarElemento(
          "div",
          "history-service-values"
        );

        valores.append(
          criarElemento(
            "span",
            "",
            `${formatarQuantidade(quantidade)} × ${formatarMoeda(precoUnitario)}`
          ),
          criarElemento(
            "strong",
            "",
            formatarMoeda(subtotalServico)
          )
        );

        linha.append(descricao, valores);
        listaServicos.append(linha);
      });
    }

    card.append(listaServicos);

    // Subtotal do atendimento.
    const subtotal = criarElemento(
      "div",
      "history-subtotal"
    );

    const subtotalInfo = document.createElement("div");

    subtotalInfo.append(
      criarElemento("strong", "", "Subtotal do atendimento"),
      criarElemento(
        "span",
        "",
        `${formatarQuantidade(subtotalQuantidade)} unidades`
      )
    );

    subtotal.append(
      subtotalInfo,
      criarElemento(
        "strong",
        "",
        formatarMoeda(subtotalValor)
      )
    );

    card.append(subtotal);

    // Observações.
    if (atendimento.observacoes) {
      card.append(
        criarElemento(
          "div",
          "history-observations",
          `Observações: ${atendimento.observacoes}`
        )
      );
    }

    timeline.append(card);
  });

  historyContent.append(timeline);

  // Resumo financeiro geral.
  const resumo = criarElemento("section", "history-total");

  resumo.append(
    criarElemento("h3", "", "Resumo geral do cliente"),
    criarElemento(
      "p",
      "",
      "Acumulado de todos os serviços registrados como executados."
    )
  );

  const resumoValores = criarElemento(
    "div",
    "history-total-grid"
  );

  const valorTotal = criarElemento(
    "div",
    "history-total-card highlight"
  );

  valorTotal.append(
    criarElemento("span", "", "Valor dos serviços"),
    criarElemento(
      "strong",
      "",
      formatarMoeda(totalGeral)
    )
  );

  const quantidadeTotal = criarElemento(
    "div",
    "history-total-card"
  );

  quantidadeTotal.append(
    criarElemento("span", "", "Total de unidades"),
    criarElemento(
      "strong",
      "",
      formatarQuantidade(totalUnidades)
    )
  );

  resumoValores.append(valorTotal, quantidadeTotal);
  resumo.append(resumoValores);

  historyContent.append(resumo);
}



function fecharHistorico() {
  historyModal.hidden = true;
  document.body.style.overflow = "";
}

function abrirHistorico(cliente) {
  historyModal.hidden = false;
  document.body.style.overflow = "hidden";

  carregarHistorico(cliente);
}

// Carrega os clientes do usuário autenticado.
async function carregarClientes() {
  clientList.replaceChildren();
  emptyState.hidden = true;

  try {
    const { data, error } = await supabaseClient
      .from("clientes")
      .select(`
        id,
        nome,
        tipo,
        documento,
        telefone,
        whatsapp,
        email,
        data_nascimento,
        endereco,
        numero,
        complemento,
        bairro,
        cidade,
        estado,
        cep,
        observacoes,
        arquivado_em
      `)
      .order("nome", { ascending: true });

    if (error) throw error;

    clients = (data ?? []).map(normalizarCliente);
    renderClients();
  } catch (error) {
    console.error("Erro ao carregar clientes:", error);
    mostrarErro("Não foi possível carregar os clientes.");
  }
}

// Converte os campos do formulário para o formato do banco.
function obterDadosFormulario() {
  const dados = {};

  camposCliente.forEach((campo) => {
    const valor = form.elements[campo]?.value.trim() ?? "";
    dados[campo] = valor || null;
  });

  return dados;
}

// Cadastra ou atualiza um cliente no Supabase.
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const botaoSalvar = form.querySelector('[type="submit"]');
  const textoOriginal = botaoSalvar.textContent;

  botaoSalvar.disabled = true;
  botaoSalvar.textContent = "Salvando...";

  try {
    const { data: usuarioData, error: usuarioError } =
      await supabaseClient.auth.getUser();

    if (usuarioError) throw usuarioError;

    const usuario = usuarioData.user;

    if (!usuario) {
      window.location.replace("login.html");
      return;
    }

    const dados = obterDadosFormulario();

    if (!dados.nome) {
      mostrarErro("Informe o nome do cliente.");
      return;
    }

    if (editingId) {
      const { error } = await supabaseClient
        .from("clientes")
        .update(dados)
        .eq("id", editingId)
        .eq("usuario_id", usuario.id);

      if (error) throw error;
    } else {
      const { error } = await supabaseClient
        .from("clientes")
        .insert({
          ...dados,
          usuario_id: usuario.id
        });

      if (error) throw error;
    }

    fecharModal();
    await carregarClientes();
  } catch (error) {
    console.error("Erro ao salvar cliente:", error);
    mostrarErro(
      "Não foi possível salvar o cliente. Verifique os dados e tente novamente."
    );
  } finally {
    botaoSalvar.disabled = false;
    botaoSalvar.textContent = textoOriginal;
  }
});

async function excluirCliente(cliente) {
  try {
    const { data: usuarioData, error: usuarioError } =
      await supabaseClient.auth.getUser();

    if (usuarioError) throw usuarioError;

    const usuario = usuarioData.user;

    if (!usuario) {
      window.location.replace("login.html");
      return;
    }

    const { data: execucoes, error: erroExecucoes } =
      await supabaseClient
        .from("execucoes_servico")
        .select("id")
        .eq("cliente_id", cliente.id)
        .eq("usuario_id", usuario.id)
        .limit(1);

    if (erroExecucoes) throw erroExecucoes;

    if (execucoes?.length) {
      mostrarErro(
        `Não é possível excluir "${cliente.nome}": existem execuções no histórico.`
      );
      return;
    }

    const { data: orcamentos, error: erroOrcamentos } =
      await supabaseClient
        .from("orcamentos")
        .select("id")
        .eq("cliente_id", cliente.id)
        .eq("usuario_id", usuario.id)
        .limit(1);

    if (erroOrcamentos) throw erroOrcamentos;

    if (orcamentos?.length) {
      mostrarErro(
        `Não é possível excluir "${cliente.nome}": existem orçamentos vinculados.`
      );
      return;
    }

    if (!confirm(`Deseja excluir permanentemente o cliente "${cliente.nome}"?`)) {
      return;
    }

    const { error } = await supabaseClient
      .from("clientes")
      .delete()
      .eq("id", cliente.id)
      .eq("usuario_id", usuario.id);

    if (error) throw error;

    await carregarClientes();
  } catch (error) {
    console.error("Erro ao excluir cliente:", error);
    mostrarErro(
      "Não foi possível excluir o cliente. Ele pode possuir execuções ou orçamentos vinculados."
    );
  }
}

// Arquiva ou reativa o cliente no banco.
async function alternarArquivamento(cliente) {
  const arquivado = clienteEstaArquivado(cliente);

  const mensagem = arquivado
    ? `Deseja reativar o cliente "${cliente.nome}"?`
    : `Deseja arquivar o cliente "${cliente.nome}"?`;

  if (!confirm(mensagem)) return;

  try {
    const { data: usuarioData, error: usuarioError } =
      await supabaseClient.auth.getUser();

    if (usuarioError) throw usuarioError;

    const usuario = usuarioData.user;

    if (!usuario) {
      window.location.replace("login.html");
      return;
    }

    const { error } = await supabaseClient
      .from("clientes")
      .update({
        arquivado_em: arquivado ? null : new Date().toISOString()
      })
      .eq("id", cliente.id)
      .eq("usuario_id", usuario.id);

    if (error) throw error;

    await carregarClientes();
  } catch (error) {
    console.error("Erro ao alterar arquivamento:", error);
    mostrarErro("Não foi possível alterar o status do cliente.");
  }
}

function renderClients() {
  const busca = searchInput.value.trim().toLowerCase();
  const filtro = filterSelect.value;

  const clientesFiltrados = clients.filter((cliente) => {
    const arquivado = clienteEstaArquivado(cliente);

    const camposBusca = [
      cliente.nome,
      cliente.documento,
      cliente.telefone,
      cliente.whatsapp,
      cliente.email,
      cliente.endereco,
      cliente.numero,
      cliente.bairro,
      cliente.cidade
    ];

    const correspondeBusca = camposBusca.some((valor) =>
      (valor ?? "").toLowerCase().includes(busca)
    );

    const correspondeFiltro =
      filtro === "todos" ||
      (filtro === "ativos" && !arquivado) ||
      (filtro === "arquivados" && arquivado);

    return correspondeBusca && correspondeFiltro;
  });

  document.querySelector("#client-count").textContent =
    clients.length;

  document.querySelector("#active-count").textContent =
    clients.filter((cliente) => !clienteEstaArquivado(cliente)).length;

  clientList.replaceChildren();

  clientesFiltrados.forEach((cliente) => {
    const arquivado = clienteEstaArquivado(cliente);
    const linha = document.createElement("tr");

    const nomeCelula = document.createElement("td");
    nomeCelula.className = "client-name";
    nomeCelula.textContent = cliente.nome;

    const telefoneCelula = document.createElement("td");
    telefoneCelula.textContent = cliente.telefone || "—";

    const emailCelula = document.createElement("td");
    emailCelula.className = "client-email";
    emailCelula.textContent = cliente.email || "—";

    const statusCelula = document.createElement("td");
    const etiqueta = document.createElement("span");

    etiqueta.className = `status-badge${arquivado ? " archived" : ""}`;
    etiqueta.textContent = arquivado ? "Arquivado" : "Ativo";
    statusCelula.append(etiqueta);

    const acoesCelula = document.createElement("td");
    const acoes = document.createElement("div");
    acoes.className = "row-actions";

    const botaoEditar = document.createElement("button");
    botaoEditar.type = "button";
    botaoEditar.className = "row-action";
    botaoEditar.textContent = "Editar";
    botaoEditar.addEventListener("click", () => abrirModal(cliente));

    const botaoArquivar = document.createElement("button");
    botaoArquivar.type = "button";
    botaoArquivar.className = "row-action danger";
    botaoArquivar.textContent = arquivado ? "Reativar" : "Arquivar";
    botaoArquivar.addEventListener("click", () =>
      alternarArquivamento(cliente)
    );

    const botaoExcluir = document.createElement("button");
    botaoExcluir.type = "button";
    botaoExcluir.className = "row-action danger";
    botaoExcluir.textContent = "Excluir";
    botaoExcluir.addEventListener("click", () => excluirCliente(cliente));

    const botaoHistorico = document.createElement("button");
botaoHistorico.type = "button";
botaoHistorico.className = "row-action";
botaoHistorico.textContent = "Histórico";

botaoHistorico.addEventListener("click", () => {
  abrirHistorico(cliente);
});

acoes.append(
  botaoEditar,
  botaoHistorico,
  // botaoArquivar,
  botaoExcluir
);
    acoesCelula.append(acoes);

    linha.append(
      nomeCelula,
      telefoneCelula,
      emailCelula,
      statusCelula,
      acoesCelula
    );

    clientList.append(linha);
  });

  emptyState.hidden = clientesFiltrados.length > 0;

  document.querySelector(".table-wrapper").hidden =
    clientesFiltrados.length === 0;
}

searchInput.addEventListener("input", renderClients);
filterSelect.addEventListener("change", renderClients);

carregarClientes();
