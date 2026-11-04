
const $ = (selector) => document.querySelector(selector);

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

const formatDate = (value) => {
  if (!value) return "—";

  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};

const todayISO = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const paymentLabels = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  transferencia: "Transferência",
  outro: "Outro"
};

const statusLabels = {
  em_aberto: "Em aberto",
  parcialmente_recebida: "Parcial",
  recebida: "Recebida",
  vencida: "Vencida"
};

const filterStatus = {
  todas: null,
  em_aberto: "em_aberto",
  parcial: "parcialmente_recebida",
  recebido: "recebida",
  vencido: "vencida"
};

let contas = [];
let clientes = [];
let parcelasAtuais = [];
let recebimentosAtuais = [];
let parcelasFinanceiro = [];
let contaSelecionada = null;

let parcelaSelecionada = null;

const financialList = $("#financial-list");
const financialEmpty = $("#financial-empty");
const financialSearch = $("#financial-search");
const financialFilter = $("#financial-filter");

const financialModal = $("#financial-modal");
const receiptModal = $("#receipt-modal");

const accountDetails = $("#financial-account-details");
const installmentsList = $("#installments-list");
const receiptsList = $("#receipts-list");

const receiptForm = $("#receipt-form");
const receiptInstallment = $("#receipt-installment");
const receiptAmount = $("#receipt-amount");
const receiptDate = $("#receipt-date");
const receiptMethod = $("#receipt-method");
const receiptNotes = $("#receipt-notes");
const receiptError = $("#receipt-error");

const toast = $("#toast");


// =====================================================
// UTILITÁRIOS
// =====================================================

const escapeHTML = (value) => {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
};

const showToast = (message, type = "success") => {
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  setTimeout(() => {
    toast.className = "toast";
  }, 3500);
};

const showError = (message) => {
  if (receiptError) {
    receiptError.textContent = message;
    receiptError.style.display = "block";
  }
};

const clearError = () => {
  if (!receiptError) return;

  receiptError.textContent = "";
  receiptError.style.display = "none";
};

const getClientName = (clienteId) => {
  const cliente = clientes.find(
    (item) => item.id === clienteId
  );

  return cliente?.nome || "Cliente não encontrado";
};

const getPaymentLabel = (method) => {
  return paymentLabels[method] || method || "—";
};

const getStatusClass = (status) => {
  return {
    em_aberto: "status-pending",
    parcialmente_recebida: "status-partial",
    recebida: "status-paid",
    vencida: "status-overdue"
  }[status] || "";
};

const getStatusLabel = (status) => {
  return statusLabels[status] || status || "—";
};

const formatNumber = (value) => {
  return Number(value || 0).toLocaleString("pt-BR");
};


// =====================================================
// AUTENTICAÇÃO
// =====================================================

const verificarUsuario = async () => {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data.user) {
    window.location.href = "./login.html";
    return false;
  }

  return true;
};


// =====================================================
// CARREGAR DADOS DO BANCO
// =====================================================

const carregarFinanceiro = async () => {
  try {
    const [
      contasResponse,
      clientesResponse,
      parcelasResponse
    ] = await Promise.all([
      supabaseClient
        .from("visao_contas_receber")
        .select("*")
        .order("criado_em", { ascending: false }),

      supabaseClient
        .from("clientes")
        .select("id, nome"),

      supabaseClient
        .from("visao_parcelas_receber")
        .select("saldo, situacao")
    ]);

    if (contasResponse.error) {
      throw contasResponse.error;
    }

    if (clientesResponse.error) {
      throw clientesResponse.error;
    }

    if (parcelasResponse.error) {
      throw parcelasResponse.error;
    }

    contas = contasResponse.data || [];
    clientes = clientesResponse.data || [];
    parcelasFinanceiro = parcelasResponse.data || [];

    renderizarIndicadores();
    renderizarContas();

  } catch (error) {
    console.error("Erro ao carregar financeiro:", error);
    showToast("Não foi possível carregar o financeiro.", "error");
  }
};

// =====================================================
// INDICADORES
// =====================================================

const renderizarIndicadores = () => {
  const totalReceivable = contas.reduce(
    (total, conta) => total + Number(conta.valor_total || 0),
    0
  );

  const totalReceived = contas.reduce(
    (total, conta) => total + Number(conta.total_recebido || 0),
    0
  );

  const totalOpen = contas.reduce(
    (total, conta) => total + Number(conta.saldo || 0),
    0
  );

  const totalOverdue = parcelasFinanceiro.reduce(
  (total, parcela) => {
    return total + (
      parcela.situacao === "vencida"
        ? Number(parcela.saldo || 0)
        : 0
    );
  },
  0
);

  $("#total-receivable").textContent = money(totalReceivable);
  $("#total-received").textContent = money(totalReceived);
  $("#total-open").textContent = money(totalOpen);
  $("#total-overdue").textContent = money(totalOverdue);
};


// =====================================================
// LISTAGEM DE CONTAS
// =====================================================

const renderizarContas = () => {
  const search = (financialSearch?.value || "")
    .trim()
    .toLowerCase();

  const selectedFilter = filterStatus[
    financialFilter?.value || "todas"
  ];

  const filtradas = contas.filter((conta) => {
    const nomeCliente = getClientName(conta.cliente_id).toLowerCase();

    const numeroOrcamento = String(
      conta.numero_orcamento ?? ""
    ).toLowerCase();

    const correspondeBusca =
      nomeCliente.includes(search) ||
      numeroOrcamento.includes(search);

    const correspondeStatus =
      !selectedFilter || conta.situacao === selectedFilter;

    return correspondeBusca && correspondeStatus;
  });

  financialList.innerHTML = "";

  if (filtradas.length === 0) {
    financialEmpty.style.display = "block";
    return;
  }

  financialEmpty.style.display = "none";

  financialList.innerHTML = filtradas.map((conta) => {
    const nomeCliente = getClientName(conta.cliente_id);

    return `
      <tr>
        <td>
          <strong>${escapeHTML(nomeCliente)}</strong>
        </td>

        <td>
          #${escapeHTML(conta.numero_orcamento)}
        </td>

        <td>${money(conta.valor_total)}</td>

        <td>${money(conta.total_recebido)}</td>

        <td>${money(conta.saldo)}</td>

        <td>
          <span class="status-badge ${getStatusClass(conta.situacao)}">
            ${escapeHTML(getStatusLabel(conta.situacao))}
          </span>
        </td>

        <td>
          <button
            class="small-action"
            type="button"
            data-account-id="${escapeHTML(conta.conta_id)}"
          >
            Detalhes
          </button>
        </td>
      </tr>
    `;
  }).join("");
};


// =====================================================
// ABRIR DETALHES DA CONTA
// =====================================================

const abrirDetalhesConta = async (contaId) => {
  const conta = contas.find(
    (item) => item.conta_id === contaId
  );

  if (!conta) return;

  contaSelecionada = conta;

  try {
    const { data, error } = await supabaseClient
      .from("visao_parcelas_receber")
      .select("*")
      .eq("conta_id", conta.conta_id)
      .order("numero_parcela", { ascending: true });

    if (error) throw error;

    parcelasAtuais = data || [];

    await carregarHistoricoRecebimentos();

    renderizarDetalhesConta();
    renderizarParcelas();
    renderizarHistorico();

    financialModal.hidden = false;
    financialModal.classList.add("active");

  } catch (error) {
    console.error("Erro ao abrir conta:", error);
    showToast("Não foi possível carregar os detalhes.", "error");
  }
};


// =====================================================
// HISTÓRICO DE RECEBIMENTOS
// =====================================================

const carregarHistoricoRecebimentos = async () => {
  const parcelaIds = parcelasAtuais.map(
    (parcela) => parcela.parcela_id
  );

  if (parcelaIds.length === 0) {
    recebimentosAtuais = [];
    return;
  }

  const { data, error } = await supabaseClient
    .from("recebimentos")
    .select(`
      id,
      parcela_id,
      valor,
      meio_pagamento,
      data_recebimento,
      observacoes,
      criado_em
    `)
    .in("parcela_id", parcelaIds)
    .order("data_recebimento", { ascending: false });

  if (error) throw error;

  recebimentosAtuais = data || [];
};


// =====================================================
// RENDERIZAR RESUMO DA CONTA
// =====================================================

const renderizarDetalhesConta = () => {
  if (!contaSelecionada) return;

  const conta = contaSelecionada;

  accountDetails.innerHTML = `
    <div class="financial-detail-grid">

      <div class="financial-detail-card">
        <span class="financial-detail-label">Cliente</span>
        <strong class="financial-detail-value">
          ${escapeHTML(getClientName(conta.cliente_id))}
        </strong>
      </div>

      <div class="financial-detail-card">
        <span class="financial-detail-label">Orçamento</span>
        <strong class="financial-detail-value">
          #${escapeHTML(conta.numero_orcamento)}
        </strong>
      </div>

      <div class="financial-detail-card">
        <span class="financial-detail-label">Valor total</span>
        <strong class="financial-detail-value">
          ${money(conta.valor_total)}
        </strong>
      </div>

      <div class="financial-detail-card">
        <span class="financial-detail-label">Total recebido</span>
        <strong class="financial-detail-value">
          ${money(conta.total_recebido)}
        </strong>
      </div>

      <div class="financial-detail-card">
        <span class="financial-detail-label">Saldo restante</span>
        <strong class="financial-detail-value">
          ${money(conta.saldo)}
        </strong>
      </div>

      <div class="financial-detail-card">
        <span class="financial-detail-label">Parcelas</span>
        <strong class="financial-detail-value">
          ${formatNumber(conta.quantidade_parcelas)}
        </strong>
      </div>

      <div class="financial-detail-card">
        <span class="financial-detail-label">Meio de pagamento</span>
        <strong class="financial-detail-value">
          ${escapeHTML(getPaymentLabel(conta.meio_pagamento))}
        </strong>
      </div>

      <div class="financial-detail-card">
        <span class="financial-detail-label">Criada em</span>
        <strong class="financial-detail-value">
          ${formatDate(conta.criado_em)}
        </strong>
      </div>

    </div>
  `;
};


// =====================================================
// RENDERIZAR PARCELAS
// =====================================================

const renderizarParcelas = () => {
  installmentsList.innerHTML = "";

  if (parcelasAtuais.length === 0) {
    installmentsList.innerHTML = `
      <tr>
        <td colspan="7">Nenhuma parcela encontrada.</td>
      </tr>
    `;
    return;
  }

  installmentsList.innerHTML = parcelasAtuais.map((parcela) => {
    const podeReceber = Number(parcela.saldo) > 0;

    return `
      <tr>
        <td>
          ${parcela.eh_entrada ? "Entrada" : `Parcela ${parcela.numero_parcela}`}
        </td>

        <td>${formatDate(parcela.vencimento_em)}</td>

        <td>${money(parcela.valor)}</td>

        <td>${money(parcela.total_recebido)}</td>

        <td>${money(parcela.saldo)}</td>

        <td>
          <span class="status-badge ${getStatusClass(parcela.situacao)}">
            ${escapeHTML(getStatusLabel(parcela.situacao))}
          </span>
        </td>

        <td>
          ${
            podeReceber
              ? `
                <button
                  class="small-action"
                  type="button"
                  data-parcel-id="${escapeHTML(parcela.parcela_id)}"
                >
                  Receber
                </button>
              `
              : "—"
          }
        </td>
      </tr>
    `;
  }).join("");
};


// =====================================================
// RENDERIZAR HISTÓRICO
// =====================================================

const renderizarHistorico = () => {
  receiptsList.innerHTML = "";

  if (recebimentosAtuais.length === 0) {
    receiptsList.innerHTML = `
      <tr>
        <td colspan="5">Nenhum recebimento registrado.</td>
      </tr>
    `;
    return;
  }

  recebimentosAtuais.sort((a, b) => {
    return new Date(b.data_recebimento) - new Date(a.data_recebimento);
  });

  receiptsList.innerHTML = recebimentosAtuais.map((recebimento) => {
    const parcela = parcelasAtuais.find(
      (item) => item.parcela_id === recebimento.parcela_id
    );

    const numeroParcela = parcela
      ? parcela.eh_entrada
        ? "Entrada"
        : `Parcela ${parcela.numero_parcela}`
      : "—";

    return `
      <tr>
        <td>${formatDate(recebimento.data_recebimento)}</td>

        <td>${escapeHTML(numeroParcela)}</td>

        <td>${money(recebimento.valor)}</td>

        <td>${escapeHTML(getPaymentLabel(recebimento.meio_pagamento))}</td>

        <td>${escapeHTML(recebimento.observacoes || "—")}</td>
      </tr>
    `;
  }).join("");
};


// =====================================================
// ABRIR MODAL DE RECEBIMENTO
// =====================================================

const abrirModalRecebimento = (parcelaId) => {
  const parcela = parcelasAtuais.find(
    (item) => item.parcela_id === parcelaId
  );

  if (!parcela || Number(parcela.saldo) <= 0) return;

  parcelaSelecionada = parcela;

  clearError();

  receiptForm.reset();

  receiptInstallment.innerHTML = `
  <option value="${escapeHTML(parcela.parcela_id)}">
    ${
      parcela.eh_entrada
        ? "Entrada"
        : `Parcela ${parcela.numero_parcela}`
    } — Saldo: ${money(parcela.saldo)}
  </option>
`;

receiptInstallment.value = parcela.parcela_id;

  receiptAmount.value = Number(parcela.saldo).toFixed(2);
  receiptDate.value = todayISO();

  receiptModal.hidden = false;
  receiptModal.classList.add("active");
};


// =====================================================
// FECHAR MODAIS
// =====================================================

const fecharModalFinanceiro = () => {
  financialModal.classList.remove("active");
  financialModal.hidden = true;
};

const fecharModalRecebimento = () => {
  receiptModal.classList.remove("active");
  receiptModal.hidden = true;
  clearError();
};

// =====================================================
// NORMALIZAR MEIO DE PAGAMENTO
// =====================================================

const normalizarMeioPagamento = (method) => {
  const methods = {
    cartao_credito: "credito",
    cartao_debito: "debito"
  };

  return methods[method] || method;
};


// =====================================================
// REGISTRAR RECEBIMENTO
// =====================================================

const registrarRecebimento = async (event) => {
  event.preventDefault();

  clearError();

  if (!parcelaSelecionada) {
    showError("Selecione uma parcela.");
    return;
  }

  const valor = Number(
    receiptAmount.value.replace(",", ".")
  );

  const meioPagamento = normalizarMeioPagamento(
    receiptMethod.value
  );

  const dataRecebimento = receiptDate.value;
  const observacoes = receiptNotes.value.trim();

  const metodosPermitidos = [
    "pix",
    "dinheiro",
    "credito",
    "debito",
    "transferencia",
    "outro"
  ];

  if (!Number.isFinite(valor) || valor <= 0) {
    showError("Informe um valor válido.");
    return;
  }

  if (!metodosPermitidos.includes(meioPagamento)) {
    showError("Selecione um meio de pagamento válido.");
    return;
  }

  if (!dataRecebimento) {
    showError("Informe a data do recebimento.");
    return;
  }

  const submitButton = receiptForm.querySelector(
    'button[type="submit"]'
  );

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Salvando...";
  }

  try {
    const { error } = await supabaseClient.rpc(
      "registrar_recebimento",
      {
        p_parcela_id: parcelaSelecionada.parcela_id,
        p_valor: valor,
        p_meio_pagamento: meioPagamento,
        p_data_recebimento: dataRecebimento,
        p_observacoes: observacoes || null
      }
    );

    if (error) throw error;

    fecharModalRecebimento();

    await carregarFinanceiro();

    if (contaSelecionada) {
      await abrirDetalhesConta(contaSelecionada.conta_id);
    }

    showToast("Recebimento registrado com sucesso!");

  } catch (error) {
    console.error("Erro ao registrar recebimento:", error);

    showError(
      error.message || "Não foi possível registrar o recebimento."
    );

  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Registrar recebimento";
    }
  }
};


// =====================================================
// EVENTOS
// =====================================================

financialSearch?.addEventListener("input", renderizarContas);

financialFilter?.addEventListener("change", renderizarContas);

financialList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-account-id]");

  if (!button) return;

  abrirDetalhesConta(button.dataset.accountId);
});

installmentsList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-parcel-id]");

  if (!button) return;

  abrirModalRecebimento(button.dataset.parcelId);
});

$("#close-financial-modal")?.addEventListener(
  "click",
  fecharModalFinanceiro
);

$("#close-receipt-modal")?.addEventListener(
  "click",
  fecharModalRecebimento
);

$("#cancel-receipt")?.addEventListener(
  "click",
  fecharModalRecebimento
);

receiptForm?.addEventListener(
  "submit",
  registrarRecebimento
);

financialModal?.addEventListener("click", (event) => {
  if (event.target === financialModal) {
    fecharModalFinanceiro();
  }
});

receiptModal?.addEventListener("click", (event) => {
  if (event.target === receiptModal) {
    fecharModalRecebimento();
  }
});


// =====================================================
// INICIALIZAÇÃO
// =====================================================

const iniciarFinanceiro = async () => {
  const autenticado = await verificarUsuario();

  if (!autenticado) return;

  if (receiptDate) {
    receiptDate.value = todayISO();
  }

  await carregarFinanceiro();
};

iniciarFinanceiro();
