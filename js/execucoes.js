
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (selector) => document.querySelector(selector);

  const form = $("#execution-form");
  const modal = $("#execution-modal");
  const detailsModal = $("#details-modal");
  const errorBox = $("#execution-error");

  let currentUser = null;
  let clients = [];
  let services = [];
  let quotes = [];
  let quoteItems = [];
  let executions = [];
  let executionItems = [];

  const today = () => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  };

  const escapeHTML = (value = "") =>
    String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);

  const formatDate = (value) => {
    if (!value) return "—";
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  };

  const money = (value) =>
    Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  const clientById = (id) =>
    clients.find((client) => client.id === id);

  const clientName = (id) =>
    clientById(id)?.nome || "Cliente não encontrado";

  const serviceById = (id) =>
    services.find((service) => service.id === id);

  const quoteById = (id) =>
    quotes.find((quote) => quote.id === id);

  const quoteItemById = (id) =>
    quoteItems.find((item) => item.id === id);

  const executionById = (id) =>
    executions.find((execution) => execution.id === id);

  const itemsForExecution = (executionId) =>
    executionItems.filter((item) => item.execucao_id === executionId);

  const executedQuantity = (quoteItemId) =>
    executionItems
      .filter((item) => item.item_orcamento_id === quoteItemId)
      .reduce((total, item) => total + Number(item.quantidade || 0), 0);

  const remainingQuantity = (item) =>
    Math.max(0, Number(item.quantidade) - executedQuantity(item.id));

  const quoteHasRemainingItems = (quote) =>
    quoteItems.some(
      (item) =>
        item.orcamento_id === quote.id &&
        remainingQuantity(item) > 0
    );

  const originLabel = (origin) => {
    if (origin === "orcamento") return "Orçamento";
    if (origin === "historico_manual") return "Histórico manual";
    return "Avulso";
  };

  function populateSelect(select, items, placeholder, getLabel) {
    select.innerHTML = "";

    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);

    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = getLabel(item);
      select.appendChild(option);
    });
  }

  function populateClients() {
    populateSelect(
      $("#execution-client"),
      clients,
      "Selecione o cliente",
      (client) => client.nome
    );
  }

  function populateServices() {
    populateSelect(
      $("#execution-service"),
      services,
      "Selecione um serviço ou descreva abaixo",
      (service) => `${service.nome} — ${money(service.preco_referencia)}`
    );
  }

  function populateQuotes() {
    const clientId = $("#execution-client").value;

    const availableQuotes = quotes.filter(
      (quote) =>
        quote.cliente_id === clientId &&
        quote.status === "aprovado" &&
        quoteHasRemainingItems(quote)
    );

    populateSelect(
      $("#execution-quote"),
      availableQuotes,
      availableQuotes.length
        ? "Selecione o orçamento"
        : "Nenhum orçamento aprovado com saldo pendente",
      (quote) => `Orçamento #${quote.numero}`
    );

    $("#execution-quote-item").innerHTML =
      '<option value="">Selecione primeiro um orçamento</option>';

    updateExecutionModeFields();
  }

  function populateQuoteItems() {
    const quoteId = $("#execution-quote").value;

    const items = quoteId
      ? quoteItems.filter(
          (item) =>
            item.orcamento_id === quoteId &&
            remainingQuantity(item) > 0
        )
      : [];

    populateSelect(
      $("#execution-quote-item"),
      items,
      items.length
        ? "Selecione o item executado"
        : "Nenhum item pendente",
      (item) =>
        `${item.descricao} — faltam ${remainingQuantity(item)}`
    );

    updateRemainingHelp();
    updateExecutionModeFields();
  }

  function updateRemainingHelp() {
    const item = quoteItemById($("#execution-quote-item").value);

    if (!item) {
      $("#remaining-help").textContent =
        "Selecione um item para consultar a quantidade pendente.";

      $("#execution-quantity").removeAttribute("max");
      return;
    }

    const done = executedQuantity(item.id);
    const remaining = remainingQuantity(item);

    $("#remaining-help").textContent =
      `Orçado: ${item.quantidade} | Já realizado: ${done} | Restante: ${remaining}`;

    $("#execution-quantity").max = String(remaining);
  }

  // Controla a exibição dos campos conforme o modo escolhido.
  function updateExecutionModeFields() {
    const origin = $("#execution-origin").value;
    const isQuote = origin === "orcamento";
    const mode = $("#execution-mode").value;
    const quoteSelected = Boolean($("#execution-quote").value);

    const isPartial = isQuote && mode === "parcial";
    const isIntegral = isQuote && mode === "integral";
    const isStandalone = !isQuote;

    $("#execution-mode-field").hidden = !isQuote;

    $("#quote-field").hidden = !isQuote;

    $("#quote-item-field").hidden =
      !isPartial || !quoteSelected;

    $("#execution-quantity-field").hidden =
      isQuote
        ? (!isPartial || !quoteSelected)
        : false;

    $("#standalone-service-field").hidden = !isStandalone;
    $("#standalone-description-field").hidden = !isStandalone;

    $("#execution-quote").required = isQuote;

    $("#execution-quote-item").required =
      isPartial && quoteSelected;

    $("#execution-description").required = isStandalone;

    $("#execution-quantity").required =
      isStandalone || (isPartial && quoteSelected);

    $("#execution-quantity").removeAttribute("max");

    if (isIntegral) {
      $("#quantity-help").textContent =
        "Todos os itens com saldo pendente serão registrados automaticamente.";

      $("#remaining-help").textContent =
        "Não é necessário selecionar os itens individualmente.";
    } else if (isPartial) {
      $("#quantity-help").textContent =
        "A quantidade não pode ultrapassar o saldo do item.";

      updateRemainingHelp();
    } else {
      $("#remaining-help").textContent =
        "Informe a quantidade realizada neste atendimento.";

      $("#quantity-help").textContent =
        "Informe a quantidade realizada neste registro.";
    }
  }

  function updateFormFields() {
    const origin = $("#execution-origin").value;
    const isQuote = origin === "orcamento";

    if (isQuote) {
      populateQuotes();
    } else {
      $("#execution-quote").value = "";
      $("#execution-quote-item").value = "";
    }

    updateExecutionModeFields();
  }

  async function loadData() {
    const {
      data: { user },
      error: authError
    } = await supabaseClient.auth.getUser();

    if (authError) throw authError;

    if (!user) {
      window.location.replace("login.html");
      return false;
    }

    currentUser = user;

    const [
      clientsResult,
      servicesResult,
      quotesResult,
      quoteItemsResult,
      executionsResult,
      executionItemsResult
    ] = await Promise.all([
      supabaseClient
        .from("clientes")
        .select("id, nome, arquivado_em")
        .eq("usuario_id", user.id)
        .is("arquivado_em", null)
        .order("nome"),

      supabaseClient
        .from("servicos")
        .select("id, nome, preco_referencia, ativo")
        .eq("usuario_id", user.id)
        .eq("ativo", true)
        .order("nome"),

      supabaseClient
        .from("orcamentos")
        .select("id, numero, cliente_id, status, criado_em")
        .eq("usuario_id", user.id)
        .order("criado_em", { ascending: false }),

      supabaseClient
        .from("itens_orcamento")
        .select(
          "id, orcamento_id, servico_id, descricao, quantidade, preco_unitario"
        )
        .eq("usuario_id", user.id),

      supabaseClient
        .from("execucoes_servico")
        .select(
          "id, cliente_id, orcamento_id, data_execucao, origem, observacoes, criado_em"
        )
        .eq("usuario_id", user.id)
        .order("data_execucao", { ascending: false }),

      supabaseClient
        .from("itens_execucao")
        .select(
          "id, execucao_id, item_orcamento_id, servico_id, descricao, quantidade, preco_unitario"
        )
        .eq("usuario_id", user.id)
    ]);

    const results = [
      clientsResult,
      servicesResult,
      quotesResult,
      quoteItemsResult,
      executionsResult,
      executionItemsResult
    ];

    const failed = results.find((result) => result.error);

    if (failed) throw failed.error;

    clients = clientsResult.data || [];
    services = servicesResult.data || [];
    quotes = quotesResult.data || [];
    quoteItems = quoteItemsResult.data || [];
    executions = executionsResult.data || [];
    executionItems = executionItemsResult.data || [];

    return true;
  }

  function renderStats() {
    $("#stat-total").textContent = executionItems.length;

    $("#stat-clients").textContent = new Set(
      executions.map((execution) => execution.cliente_id)
    ).size;

    $("#stat-progress").textContent = quotes.filter(
      (quote) =>
        quote.status === "aprovado" &&
        quoteHasRemainingItems(quote)
    ).length;
  }

  
function renderExecutions() {
  const search = $("#search-executions").value
    .trim()
    .toLocaleLowerCase("pt-BR");

  const type = $("#filter-type").value;
  const date = $("#filter-date").value;
  const rows = [];

  executions.forEach((execution) => {
    const quote = quoteById(execution.orcamento_id);
    const items = itemsForExecution(execution.id);

    items.forEach((item) => {
      const haystack = [
        clientName(execution.cliente_id),
        item.descricao,
        quote ? `orcamento ${quote.numero}` : "",
        execution.observacoes || ""
      ].join(" ").toLocaleLowerCase("pt-BR");

      if (search && !haystack.includes(search)) return;
      if (type !== "todos" && execution.origem !== type) return;
      if (date && execution.data_execucao !== date) return;

      rows.push({ execution, item, quote });
    });
  });

  rows.sort((a, b) =>
    b.execution.data_execucao.localeCompare(a.execution.data_execucao)
  );

  const tbody = $("#executions-table-body");
  tbody.innerHTML = "";

  rows.forEach(({ execution, item, quote }) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <span class="table-primary">
          ${escapeHTML(formatDate(execution.data_execucao))}
        </span>
      </td>

      <td>
        <span class="table-primary">
          ${escapeHTML(clientName(execution.cliente_id))}
        </span>
      </td>

      <td>
        <span class="table-primary">
          ${escapeHTML(item.descricao)}
        </span>
        <span class="table-secondary">
          ${
            quote
              ? `Orçamento #${escapeHTML(quote.numero)}`
              : "Registro independente"
          }
        </span>
      </td>

      <td>
        <span class="origin-badge ${execution.origem === "avulso" ? "avulso" : ""}">
          ${escapeHTML(originLabel(execution.origem))}
        </span>
      </td>

      <td>
        <span class="table-primary">
          ${escapeHTML(item.quantidade)}
        </span>
      </td>

      <td>
        <button class="row-action" data-details="${escapeHTML(execution.id)}">
          Detalhes
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  $("#record-count").textContent =
    `${rows.length} ${rows.length === 1 ? "registro" : "registros"}`;

  $("#empty-state").hidden = rows.length > 0;
  $(".table-wrapper").hidden = rows.length === 0;

  renderStats();
}


  async function refreshData() {
    await loadData();
    renderExecutions();
  }

  function openModal() {
    form.reset();

    errorBox.hidden = true;
    errorBox.textContent = "";

    $("#execution-date").value = today();

    populateClients();
    populateServices();
    updateFormFields();

    modal.hidden = false;
    document.body.style.overflow = "hidden";

    $("#execution-client").focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = detailsModal.hidden ? "" : "hidden";
  }

  function openDetails(executionId) {
    const execution = executionById(executionId);
    if (!execution) return;

    const quote = quoteById(execution.orcamento_id);
    const items = itemsForExecution(execution.id);

    const details = [
      ["Cliente", clientName(execution.cliente_id)],
      ["Data", formatDate(execution.data_execucao)],
      ["Origem", originLabel(execution.origem)],
      ["Orçamento", quote ? `#${quote.numero}` : "Não se aplica"],
      ["Observações", execution.observacoes || "Nenhuma observação."]
    ];

    items.forEach((item, index) => {
      const quoteItem = quoteItemById(item.item_orcamento_id);

      details.push(
        [`Serviço ${index + 1}`, item.descricao],
        [`Quantidade realizada ${index + 1}`, item.quantidade],
        [`Preço unitário ${index + 1}`, money(item.preco_unitario)],
        [
          `Subtotal ${index + 1}`,
          money(Number(item.quantidade) * Number(item.preco_unitario))
        ]
      );

      if (quoteItem) {
        details.push(
          [`Quantidade orçada (${item.descricao})`, quoteItem.quantidade],
          [
            `Total já executado (${item.descricao})`,
            executedQuantity(quoteItem.id)
          ],
          [
            `Saldo restante (${item.descricao})`,
            remainingQuantity(quoteItem)
          ]
        );
      }
    });

    $("#execution-details-content").innerHTML = details.map(([label, value]) => `
      <div class="detail-row">
        <span class="detail-label">${escapeHTML(label)}</span>
        <span class="detail-value">${escapeHTML(value)}</span>
      </div>
    `).join("");

    detailsModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDetails() {
    detailsModal.hidden = true;
    document.body.style.overflow = modal.hidden ? "" : "hidden";
  }

  async function saveExecution(event) {
    event.preventDefault();

    errorBox.hidden = true;
    errorBox.textContent = "";

    const clientId = $("#execution-client").value;
    const origin = $("#execution-origin").value;
    const date = $("#execution-date").value;
    const notes = $("#execution-notes").value.trim();

    const quantity = Number($("#execution-quantity").value);

    if (!clientId || !date) {
      showError("Preencha os campos obrigatórios.");
      return;
    }

    if (date > today()) {
      showError("A data da execução não pode ser futura.");
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;

    try {
      // ORÇAMENTO: usar a função RPC transacional.
      if (origin === "orcamento") {
        const quoteId = $("#execution-quote").value;
        const mode = $("#execution-mode").value;

        let quoteItemId = null;
        let executionQuantity = null;

        if (!quoteId) {
          throw new Error("Selecione um orçamento.");
        }

        if (!["parcial", "integral"].includes(mode)) {
          throw new Error("Selecione um modo de execução válido.");
        }

        // Atualizar os dados antes de validar o saldo.
        await loadData();

        const quote = quoteById(quoteId);

        if (
          !quote ||
          quote.cliente_id !== clientId ||
          quote.status !== "aprovado"
        ) {
          throw new Error(
            "O orçamento selecionado não está disponível ou não pertence a este cliente."
          );
        }

        if (!quoteHasRemainingItems(quote)) {
          throw new Error("Este orçamento não possui itens pendentes.");
        }

        if (mode === "parcial") {
          quoteItemId = $("#execution-quote-item").value;

          const quoteItem = quoteItemById(quoteItemId);

          if (
            !quoteItem ||
            quoteItem.orcamento_id !== quoteId
          ) {
            throw new Error("Selecione um item válido do orçamento.");
          }

          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error("Informe uma quantidade válida.");
          }

          const remaining = remainingQuantity(quoteItem);

          if (quantity > remaining) {
            throw new Error(
              `A quantidade ultrapassa o saldo pendente (${remaining}).`
            );
          }

          executionQuantity = quantity;
        }

        const { error: rpcError } = await supabaseClient.rpc(
          "registrar_execucao_orcamento",
          {
            p_cliente_id: clientId,
            p_orcamento_id: quoteId,
            p_data_execucao: date,
            p_observacoes: notes || null,
            p_modo: mode,
            p_item_orcamento_id: quoteItemId,
            p_quantidade: executionQuantity
          }
        );

        if (rpcError) throw rpcError;

      } else {
        // AVULSO E HISTÓRICO MANUAL: fluxo independente.
        const description = $("#execution-description").value.trim();
        const serviceId = $("#execution-service").value || null;

        if (!description) {
          throw new Error("Informe a descrição do serviço realizado.");
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("Informe uma quantidade válida.");
        }

        const service = serviceById(serviceId);
        const unitPrice = service
          ? Number(service.preco_referencia)
          : 0;

        const { data: createdExecution, error: executionError } =
          await supabaseClient
            .from("execucoes_servico")
            .insert({
              usuario_id: currentUser.id,
              cliente_id: clientId,
              orcamento_id: null,
              data_execucao: date,
              origem: origin,
              observacoes: notes || null
            })
            .select("id")
            .single();

        if (executionError) throw executionError;

        const { error: itemError } = await supabaseClient
          .from("itens_execucao")
          .insert({
            usuario_id: currentUser.id,
            execucao_id: createdExecution.id,
            item_orcamento_id: null,
            servico_id: serviceId,
            descricao: description,
            quantidade,
            preco_unitario: unitPrice
          });

        if (itemError) {
          const { error: rollbackError } = await supabaseClient
            .from("execucoes_servico")
            .delete()
            .eq("id", createdExecution.id)
            .eq("usuario_id", currentUser.id);

          if (rollbackError) {
            console.error(
              "Não foi possível desfazer a execução incompleta:",
              rollbackError
            );
          }

          throw itemError;
        }
      }

      await refreshData();
      closeModal();

    } catch (error) {
      console.error("Erro ao salvar execução:", error);

      showError(
        error.message || "Não foi possível salvar a execução."
      );

      try {
        await refreshData();
      } catch (refreshError) {
        console.error("Erro ao atualizar os dados:", refreshError);
      }

    } finally {
      submitButton.disabled = false;
    }
  }

  // Eventos dos modais.
  $("#open-execution-modal").addEventListener("click", openModal);
  $("#close-execution-modal").addEventListener("click", closeModal);
  $("#cancel-execution").addEventListener("click", closeModal);

  $("#close-details-modal").addEventListener("click", closeDetails);
  $("#close-details-button").addEventListener("click", closeDetails);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  detailsModal.addEventListener("click", (event) => {
    if (event.target === detailsModal) closeDetails();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!detailsModal.hidden) closeDetails();
      else if (!modal.hidden) closeModal();
    }
  });

  // Eventos do formulário.
  $("#execution-client").addEventListener("change", () => {
    if ($("#execution-origin").value === "orcamento") {
      populateQuotes();
    }
  });

  $("#execution-origin").addEventListener("change", updateFormFields);

  $("#execution-mode").addEventListener(
    "change",
    updateExecutionModeFields
  );

  $("#execution-quote").addEventListener("change", () => {
    populateQuoteItems();
  });

  $("#execution-quote-item").addEventListener(
    "change",
    updateRemainingHelp
  );

  $("#execution-service").addEventListener("change", () => {
    const service = serviceById($("#execution-service").value);

    if (service) {
      $("#execution-description").value = service.nome;
    }
  });

  // Filtros do histórico.
  $("#search-executions").addEventListener("input", renderExecutions);
  $("#filter-type").addEventListener("change", renderExecutions);
  $("#filter-date").addEventListener("change", renderExecutions);

  $("#clear-filters").addEventListener("click", () => {
    $("#search-executions").value = "";
    $("#filter-type").value = "todos";
    $("#filter-date").value = "";
    renderExecutions();
  });

  $("#executions-table-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-details]");
    if (button) openDetails(button.dataset.details);
  });

  form.addEventListener("submit", saveExecution);

  // Inicialização.
  try {
    const loaded = await loadData();

    if (!loaded) return;

    populateClients();
    populateServices();
    updateFormFields();
    renderExecutions();

  } catch (error) {
    console.error("Erro ao carregar execuções:", error);

    showError(
      "Não foi possível carregar os dados do Supabase. Verifique a conexão e as permissões RLS."
    );

    $("#empty-state").hidden = false;
    $(".table-wrapper").hidden = true;
  }
});
