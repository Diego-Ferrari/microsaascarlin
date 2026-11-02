
const $ = (selector) => document.querySelector(selector);

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

const today = new Date();

const dateISO = (date) => {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
};

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return dateISO(result);
};

const formatDate = (value) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR")
    : "—";

const statusLabels = {
  rascunho: "Rascunho",
  pendente: "Aguardando resposta",
  aprovado: "Aprovado",
  recusado: "Recusado",
  cancelado: "Cancelado",
  concluido: "Concluído"
};

let services = [];
let clients = [];
let quotes = [];
let editingQuoteId = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function showError(message, error) {
  console.error(message, error);
  alert(message);
}

async function getUser() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error) throw error;

  if (!data.user) {
    window.location.replace("login.html");
    throw new Error("Usuário não autenticado.");
  }

  return data.user;
}

function getClient(clientId) {
  return clients.find((client) => client.id === clientId);
}

function getService(serviceId) {
  return services.find((service) => service.id === serviceId);
}

function getSubtotal(items) {
  return items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.price),
    0
  );
}

function getTotal(quote) {
  return Math.max(0, getSubtotal(quote.items) - quote.discount);
}

// ================================
// CARREGAR DADOS DO SUPABASE
// ================================

async function loadData() {
  try {
    const user = await getUser();

    const [
      { data: clientsData, error: clientsError },
      { data: servicesData, error: servicesError },
      { data: quotesData, error: quotesError },
      { data: itemsData, error: itemsError }
    ] = await Promise.all([
      supabaseClient
        .from("clientes")
        .select("id, nome, telefone")
        .is("arquivado_em", null)
        .order("nome"),

      supabaseClient
        .from("servicos")
        .select("id, nome, preco_referencia, ativo")
        .eq("ativo", true)
        .order("nome"),

      supabaseClient
        .from("orcamentos")
        .select(
          "id, numero, cliente_id, status, desconto, validade_em, observacoes, criado_em"
        )
        .eq("usuario_id", user.id)
        .order("criado_em", { ascending: false }),

      supabaseClient
        .from("itens_orcamento")
        .select(
          "id, orcamento_id, servico_id, descricao, quantidade, preco_unitario"
        )
        .eq("usuario_id", user.id)
    ]);

    if (clientsError) throw clientsError;
    if (servicesError) throw servicesError;
    if (quotesError) throw quotesError;
    if (itemsError) throw itemsError;

    clients = (clientsData ?? []).map((client) => ({
      id: client.id,
      name: client.nome,
      phone: client.telefone ?? ""
    }));

    services = (servicesData ?? []).map((service) => ({
      id: service.id,
      name: service.nome,
      price: Number(service.preco_referencia)
    }));

    const itemsByQuote = new Map();

    (itemsData ?? []).forEach((item) => {
      if (!itemsByQuote.has(item.orcamento_id)) {
        itemsByQuote.set(item.orcamento_id, []);
      }

      itemsByQuote.get(item.orcamento_id).push({
        id: item.id,
        serviceId: item.servico_id,
        description: item.descricao,
        quantity: Number(item.quantidade),
        price: Number(item.preco_unitario)
      });
    });

    quotes = (quotesData ?? []).map((quote) => ({
      id: quote.id,
      number: `ORC-${String(quote.numero).padStart(4, "0")}`,
      clientId: quote.cliente_id,
      date: quote.criado_em
        ? dateISO(new Date(quote.criado_em))
        : dateISO(today),
      validity: quote.validade_em ?? "",
      notes: quote.observacoes ?? "",
      items: itemsByQuote.get(quote.id) ?? [],
      discount: Number(quote.desconto),
      status: quote.status
    }));

    populateClients();
    renderQuotes();
  } catch (error) {
    showError("Não foi possível carregar os orçamentos.", error);
  }
}

// ================================
// LISTAGEM E INDICADORES
// ================================

function renderStats() {
  $("#total-quotes").textContent = quotes.length;

  $("#pending-quotes").textContent =
    quotes.filter((quote) => quote.status === "pendente").length;

  $("#approved-quotes").textContent =
    quotes.filter((quote) => quote.status === "aprovado").length;

  const openValue = quotes
    .filter((quote) => quote.status === "pendente")
    .reduce((sum, quote) => sum + getTotal(quote), 0);

  $("#open-value").textContent = money(openValue);
}

function renderQuotes() {
  const query = $("#quote-search").value.trim().toLowerCase();
  const status = $("#status-filter").value;

  const filtered = quotes.filter((quote) => {
    const clientName = getClient(quote.clientId)?.name ?? "";

    const matchesQuery =
      quote.number.toLowerCase().includes(query) ||
      clientName.toLowerCase().includes(query);

    return matchesQuery &&
      (status === "todos" || quote.status === status);
  });

  $("#quote-list").replaceChildren();

  filtered.forEach((quote) => {
    const client = getClient(quote.clientId);
    const row = document.createElement("tr");

    const values = [
      quote.number,
      client?.name ?? "Cliente não disponível",
      formatDate(quote.date),
      formatDate(quote.validity),
      money(getTotal(quote)),
      statusLabels[quote.status] ?? quote.status
    ];

    values.forEach((value, index) => {
      const cell = document.createElement("td");

      if (index === 0) {
        const number = document.createElement("span");
        number.className = "quote-number";
        number.textContent = value;
        cell.append(number);
      } else if (index === 1) {
        const name = document.createElement("span");
        name.className = "client-name";
        name.textContent = value;
        cell.append(name);
      } else if (index === 4) {
        const total = document.createElement("strong");
        total.textContent = value;
        cell.append(total);
      } else if (index === 5) {
        const badge = document.createElement("span");
        badge.className = `status-badge status-${quote.status}`;
        badge.textContent = value;
        cell.append(badge);
      } else {
        cell.textContent = value;
      }

      row.append(cell);
    });

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small-action";
    edit.textContent = "Editar";
    edit.addEventListener("click", () => openModal(quote));

    const whatsapp = document.createElement("button");
    whatsapp.type = "button";
    whatsapp.className = "small-action";
    whatsapp.textContent = "WhatsApp";
    whatsapp.addEventListener("click", () => shareWhatsApp(quote.id));

    const pdf = document.createElement("button");
    pdf.type = "button";
    pdf.className = "small-action";
    pdf.textContent = "PDF";
    pdf.addEventListener("click", () => {
      try {
        downloadQuotePDF(quote);
        showToast("PDF gerado com sucesso!");
      } catch (error) {
        console.error("Erro ao gerar PDF:", error);
        showToast("Não foi possível gerar o PDF.");
      }
    });

    const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "small-action";
      remove.textContent = "Excluir";
      remove.addEventListener("click", () => deleteQuote(quote));

      actions.append(edit,pdf, whatsapp, remove);
          actionsCell.append(actions);
          row.append(actionsCell);

    $("#quote-list").append(row);
  });

  $("#quote-empty").hidden = filtered.length > 0;
  $(".table-wrapper").hidden = filtered.length === 0;

  renderStats();
}

function populateClients(selectedId = "") {
  const select = $("#quote-client");
  select.replaceChildren(new Option("Selecione um cliente", ""));

  clients.forEach((client) => {
    select.add(new Option(client.name, client.id));
  });

  select.value = selectedId;
}

// ================================
// MODAL E ITENS
// ================================

function openModal(quote = null) {
  editingQuoteId = quote?.id ?? null;

  $("#quote-form").reset();
  $("#quote-items-list").replaceChildren();
  $("#form-error").hidden = true;

  $("#modal-title").textContent = quote
    ? `Editar ${quote.number}`
    : "Novo orçamento";

  populateClients(quote?.clientId ?? "");
  $("#quote-date").value = quote?.date ?? dateISO(today);
  $("#quote-validity").value =
    quote?.validity || addDays(today, 15);
  $("#quote-status").value = quote?.status ?? "pendente";
  $("#quote-notes").value = quote?.notes ?? "";
  $("#quote-discount").value = quote?.discount ?? 0;

  const items = quote?.items ?? [
    { serviceId: null, description: "", quantity: 1, price: 0 }
  ];

  items.forEach(addItemRow);
  updateTotals();

  $("#quote-modal").hidden = false;
  document.body.style.overflow = "hidden";
  $("#quote-client").focus();
}

function closeModal() {
  $("#quote-modal").hidden = true;
  document.body.style.overflow = "";
  editingQuoteId = null;
}


function addItemRow(item = {}) {
  const row = document.createElement("div");
  row.className = "quote-item-row";

  if (item.id) {
    row.dataset.itemId = item.id;
  }

  // Identifica se é serviço do catálogo ou item avulso.
  const selectedService = item.serviceId
    ? String(item.serviceId)
    : (item.id ? "" : "avulso");

  const options = services.map((service) => `
    <option value="${service.id}"
      ${selectedService === service.id ? "selected" : ""}>
      ${escapeHTML(service.name)}
    </option>
  `).join("");

  row.innerHTML = `
    <div class="item-description-group">
      <select class="item-source" aria-label="Escolher serviço">
        <option value="">Selecione um serviço</option>
        ${options}
        <option value="avulso"
          ${selectedService === "avulso" ? "selected" : ""}>
          + Item avulso
        </option>
      </select>

      <input class="item-description" type="text" maxlength="150"
        placeholder="Descrição do item avulso"
        aria-label="Descrição do item" required>
    </div>

    <input class="item-quantity" type="number" min="0.001" step="0.001"
      aria-label="Quantidade" required>

    <input class="item-price" type="number" min="0" step="0.01"
      aria-label="Preço unitário" required>

    <strong class="item-line-total">${money(0)}</strong>

    <button type="button" class="remove-item"
      aria-label="Remover item">×</button>
  `;

  $("#quote-items-list").append(row);

  const source = row.querySelector(".item-source");
  const description = row.querySelector(".item-description");
  const quantity = row.querySelector(".item-quantity");
  const price = row.querySelector(".item-price");

  // Restaura os dados já salvos, inclusive os itens avulsos.
  description.value = item.description ?? "";
  quantity.value = item.quantity ?? 1;
  price.value = item.price ?? 0;

  function updateSource() {
    const service = getService(source.value);

    if (service) {
      description.value = service.name;
      description.readOnly = true;

      // Atualiza o preço somente quando o serviço é trocado.
      if (source.value !== String(item.serviceId ?? "")) {
        price.value = service.price;
      }
    } else {
      description.readOnly = false;

      // Limpa os campos apenas ao selecionar um novo item avulso.
      if (source.value === "avulso" && !item.id) {
        description.value = "";
        price.value = 0;
      }
    }

    updateTotals();
  }

  // Os eventos precisam ficar dentro da função,
  // pois utilizam elementos criados para esta linha.
  source.addEventListener("change", updateSource);
  quantity.addEventListener("input", updateTotals);
  price.addEventListener("input", updateTotals);
  description.addEventListener("input", updateTotals);

  updateSource();
}


function readItems() {
  return [...document.querySelectorAll(".quote-item-row")].map((row) => {
    const source = row.querySelector(".item-source").value;

    return {
      id: row.dataset.itemId || null,
      serviceId: source && source !== "avulso" ? source : null,
      description: row.querySelector(".item-description").value.trim(),
      quantity: Number(row.querySelector(".item-quantity").value),
      price: Number(row.querySelector(".item-price").value)
    };
  });
}

function updateTotals() {
  let subtotal = 0;

  document.querySelectorAll(".quote-item-row").forEach((row) => {
    const quantity = Number(row.querySelector(".item-quantity").value) || 0;
    const price = Number(row.querySelector(".item-price").value) || 0;
    const total = quantity * price;

    row.querySelector(".item-line-total").textContent = money(total);
    subtotal += total;
  });

  const discount = Math.max(0, Number($("#quote-discount").value) || 0);

  $("#quote-subtotal").textContent = money(subtotal);
  $("#quote-total").textContent = money(Math.max(0, subtotal - discount));
}

function showFormError(message) {
  $("#form-error").textContent = message;
  $("#form-error").hidden = false;
}

// ================================
// SALVAR ORÇAMENTO E ITENS
// ================================

async function saveQuote(event) {
  event.preventDefault();

  const button = $("#quote-form").querySelector('[type="submit"]');
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Salvando...";
  $("#form-error").hidden = true;

  try {
    const user = await getUser();
    const items = readItems();
    const discount = Number($("#quote-discount").value) || 0;
    const subtotal = getSubtotal(items);

    if (!$("#quote-client").value) {
      showFormError("Selecione um cliente.");
      return;
    }

    if (!items.length || items.some((item) =>
      !item.description ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.price) ||
      item.price < 0
    )) {
      showFormError(
        "Confira os itens, descrições, quantidades e preços."
      );
      return;
    }

    if (discount < 0 || discount > subtotal) {
      showFormError(
        "O desconto deve ser maior ou igual a zero e não pode superar o subtotal."
      );
      return;
    }

    const validity = $("#quote-validity").value;

    if (!validity) {
      showFormError("Informe a validade do orçamento.");
      return;
    }

    const quoteData = {
      usuario_id: user.id,
      cliente_id: $("#quote-client").value,
      validade_em: validity,
      observacoes: $("#quote-notes").value.trim() || null,
      desconto: discount,
      status: $("#quote-status").value
    };

    let quoteId = editingQuoteId;

    if (editingQuoteId) {
  const { error } = await supabaseClient
    .from("orcamentos")
    .update({
      cliente_id: quoteData.cliente_id,
      validade_em: quoteData.validade_em,
      observacoes: quoteData.observacoes,
      desconto: quoteData.desconto,
      status: quoteData.status,
      atualizado_em: new Date().toISOString()
    })
    .eq("id", editingQuoteId)
    .eq("usuario_id", user.id);

    if (error) throw error;
  } else {
      const { data, error } = await supabaseClient
        .from("orcamentos")
        .insert(quoteData)
        .select("id")
        .single();

          if (error) throw error;
          quoteId = data.id;
      }

    // Reconciliar itens: atualizar os existentes, inserir novos
    // e remover os retirados do formulário.
    const { data: existingItems, error: existingError } =
      await supabaseClient
        .from("itens_orcamento")
        .select("id")
        .eq("orcamento_id", quoteId)
        .eq("usuario_id", user.id);

    if (existingError) throw existingError;

    const existingIds = new Set(
      (existingItems ?? []).map((item) => item.id)
    );

    const submittedIds = new Set(
      items.filter((item) => item.id).map((item) => item.id)
    );

    const removedIds = [...existingIds].filter(
      (id) => !submittedIds.has(id)
    );

    if (removedIds.length) {
      const { error } = await supabaseClient
        .from("itens_orcamento")
        .delete()
        .eq("orcamento_id", quoteId)
        .eq("usuario_id", user.id)
        .in("id", removedIds);

      if (error) {
        throw new Error(
          "Não foi possível remover um item. Ele pode estar vinculado a uma execução."
        );
      }
    }

    const updates = items.filter((item) => item.id);
    const inserts = items.filter((item) => !item.id);

    for (const item of updates) {
      if (!existingIds.has(item.id)) {
        throw new Error("Um dos itens não pertence a este orçamento.");
      }

      const { error } = await supabaseClient
        .from("itens_orcamento")
        .update({
          servico_id: item.serviceId,
          descricao: item.description,
          quantidade: item.quantity,
          preco_unitario: item.price
        })
        .eq("id", item.id)
        .eq("orcamento_id", quoteId)
        .eq("usuario_id", user.id);

      if (error) throw error;
    }

    if (inserts.length) {
      const rows = inserts.map((item) => ({
        usuario_id: user.id,
        orcamento_id: quoteId,
        servico_id: item.serviceId,
        descricao: item.description,
        quantidade: item.quantity,
        preco_unitario: item.price
      }));

      const { error } = await supabaseClient
        .from("itens_orcamento")
        .insert(rows);

      if (error) throw error;
    }

    closeModal();
    await loadData();
    showToast("Orçamento salvo com sucesso!");
  } catch (error) {
    showError(
      error.message?.includes("vinculado a uma execução")
        ? error.message
        : "Não foi possível salvar o orçamento. Confira o console para ver o erro.",
      error
    );
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

// ================================
// COMPARTILHAR NO WHATSAPP
// ================================

// ================================
// GERAR PDF DO ORÇAMENTO
// ================================

function generateQuotePDF(quote) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const client = getClient(quote.clientId);

  if (!client) {
    throw new Error("Cliente não encontrado.");
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;

  const subtotal = getSubtotal(quote.items);
  const total = getTotal(quote);

  // Cabeçalho
  doc.setFillColor(11, 17, 32);
  doc.rect(0, 0, pageWidth, 38, "F");

  doc.setTextColor(255, 201, 40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("CARLIN ELETRICA", margin, 17);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Proposta comercial de servicos", margin, 25);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(quote.number, pageWidth - margin, 18, {
    align: "right"
  });

  // Dados do orçamento
  let y = 50;

  doc.setTextColor(30, 40, 55);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("DADOS DO ORCAMENTO", margin, y);

  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  doc.text(`Data: ${formatDate(quote.date)}`, margin, y);
  doc.text(
    `Validade: ${formatDate(quote.validity)}`,
    margin + 65,
    y
  );

  y += 8;

  doc.text(
    `Status: ${statusLabels[quote.status] ?? quote.status}`,
    margin,
    y
  );

  // Dados do cliente
  y += 15;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("CLIENTE", margin, y);

  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Nome: ${client.name}`, margin, y);

  if (client.phone) {
    y += 6;
    doc.text(`Telefone: ${client.phone}`, margin, y);
  }

  // Tabela de itens
  y += 12;

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [[
      "Descricao",
      "Quantidade",
      "Valor unitario",
      "Total"
    ]],
    body: quote.items.map((item) => [
      item.description,
      String(item.quantity),
      money(item.price),
      money(item.quantity * item.price)
    ]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 3,
      textColor: [40, 50, 65],
      lineColor: [220, 225, 232]
    },
    headStyles: {
      fillColor: [11, 26, 48],
      textColor: [255, 255, 255],
      fontStyle: "bold"
    },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "center", cellWidth: 25 },
      2: { halign: "right", cellWidth: 35 },
      3: { halign: "right", cellWidth: 35 }
    }
  });

  // Resumo financeiro
  let summaryY = doc.lastAutoTable.finalY + 12;

  if (summaryY > 245) {
    doc.addPage();
    summaryY = 25;
  }

  const summaryX = pageWidth - margin;
  doc.setFontSize(10);
  doc.setTextColor(50, 60, 75);

  doc.setFont("helvetica", "normal");
  doc.text(`Subtotal: ${money(subtotal)}`, summaryX, summaryY, {
    align: "right"
  });

  summaryY += 7;

  doc.text(`Desconto: ${money(quote.discount)}`, summaryX, summaryY, {
    align: "right"
  });

  summaryY += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(160, 115, 0);
  doc.text(`TOTAL: ${money(total)}`, summaryX, summaryY, {
    align: "right"
  });

  // Observações
  if (quote.notes) {
    summaryY += 15;

    if (summaryY > 260) {
      doc.addPage();
      summaryY = 25;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 40, 55);
    doc.text("OBSERVACOES", margin, summaryY);

    summaryY += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    const noteLines = doc.splitTextToSize(
      quote.notes,
      contentWidth
    );

    doc.text(noteLines, margin, summaryY);
  }

  // Rodapé em todas as páginas
  const pageCount = doc.internal.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    const pageHeight = doc.internal.pageSize.getHeight();

    doc.setDrawColor(220, 225, 232);
    doc.line(
      margin,
      pageHeight - 15,
      pageWidth - margin,
      pageHeight - 15
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 140, 155);

    doc.text(
      "Carlin Eletrica - Proposta comercial",
      margin,
      pageHeight - 9
    );

    doc.text(
      `Pagina ${page} de ${pageCount}`,
      pageWidth - margin,
      pageHeight - 9,
      { align: "right" }
    );
  }

  return doc;
}

function getQuotePDFFile(quote) {
  const doc = generateQuotePDF(quote);
  const blob = doc.output("blob");

  const filename = `${quote.number.toLowerCase()}.pdf`;

  return new File([blob], filename, {
    type: "application/pdf"
  });
}

function downloadQuotePDF(quote) {
  const doc = generateQuotePDF(quote);
  doc.save(`${quote.number.toLowerCase()}.pdf`);
}

// ================================
// COMPARTILHAR NO WHATSAPP
// ================================

async function shareWhatsApp(quoteId) {
  const quote = quotes.find((item) => item.id === quoteId);

  if (!quote) return;

  const client = getClient(quote.clientId);

  if (!client?.phone) {
    showToast("Cadastre o telefone do cliente antes de compartilhar.");
    return;
  }

  let phone = client.phone.replace(/\D/g, "");

  if (phone.length === 10 || phone.length === 11) {
    phone = `55${phone}`;
  }

  const message = [
    `Olá, ${client.name}!`,
    "",
    `Segue o orçamento ${quote.number} em PDF.`,
    "",
    `Total: ${money(getTotal(quote))}`,
    `Validade: ${formatDate(quote.validity)}`,
    "",
    "Qualquer dúvida, estou à disposição!"
  ].join("\n");

  const whatsappUrl =
    `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  // Abre a janela durante o clique para evitar bloqueio de pop-up.
  const whatsappWindow = window.open("about:blank", "_blank");

  try {
    const file = getQuotePDFFile(quote);

    // Compartilhamento nativo do PDF, principalmente em celulares.
    if (
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: `Orçamento ${quote.number}`,
          text: message
        });

        if (whatsappWindow) whatsappWindow.close();
        return;
      } catch (error) {
        // Se o usuário cancelar o compartilhamento, não abre o WhatsApp.
        if (error.name === "AbortError") {
          if (whatsappWindow) whatsappWindow.close();
          return;
        }

        console.warn(
          "Compartilhamento nativo indisponível:",
          error
        );
      }
    }

    // Fallback: baixa o PDF e abre a conversa do WhatsApp.
    const doc = generateQuotePDF(quote);
    doc.save(`${quote.number.toLowerCase()}.pdf`);

    if (whatsappWindow) {
      whatsappWindow.location.href = whatsappUrl;
    } else {
      window.location.href = whatsappUrl;
    }

    showToast(
      "PDF baixado. Anexe o arquivo à conversa do WhatsApp."
    );

  } catch (error) {
    if (whatsappWindow) whatsappWindow.close();

    console.error("Erro ao gerar ou compartilhar PDF:", error);
    showToast("Não foi possível gerar o PDF do orçamento.");
  }
}


async function deleteQuote(quote) {
  const confirmed = window.confirm(
    `Deseja realmente excluir o orçamento ${quote.number}?\n\n` +
    "Essa ação não poderá ser desfeita."
  );

  if (!confirmed) return;

  try {
    const user = await getUser();

    // Primeiro, verifica se os itens estão vinculados
    // a alguma execução de serviço.
    const { data: items, error: itemsError } =
      await supabaseClient
        .from("itens_orcamento")
        .select("id")
        .eq("orcamento_id", quote.id)
        .eq("usuario_id", user.id);

    if (itemsError) throw itemsError;

    const itemIds = (items ?? []).map((item) => item.id);

    if (itemIds.length > 0) {
      const { data: linkedItems, error: linkedError } =
        await supabaseClient
          .from("itens_execucao")
          .select("id")
          .in("item_orcamento_id", itemIds)
          .limit(1);

      if (linkedError) throw linkedError;

      if (linkedItems?.length) {
        showToast(
          "Não é possível excluir: há itens vinculados ao histórico de execuções."
        );
        return;
      }
    }

    // Exclui os itens do orçamento.
    const { error: deleteItemsError } =
      await supabaseClient
        .from("itens_orcamento")
        .delete()
        .eq("orcamento_id", quote.id)
        .eq("usuario_id", user.id);

    if (deleteItemsError) throw deleteItemsError;

    // Exclui o orçamento.
    const { error: deleteQuoteError } =
      await supabaseClient
        .from("orcamentos")
        .delete()
        .eq("id", quote.id)
        .eq("usuario_id", user.id);

    if (deleteQuoteError) throw deleteQuoteError;

    await loadData();
    showToast(`Orçamento ${quote.number} excluído com sucesso!`);

  } catch (error) {
    console.error("Erro ao excluir orçamento:", error);
    showToast(
      "Não foi possível excluir o orçamento. Verifique se ele possui vínculos com execuções."
    );
  }
}


// ================================
// EVENTOS
// ================================

$("#new-quote").addEventListener("click", () => openModal());
$("#empty-new-quote").addEventListener("click", () => openModal());

$("#close-modal").addEventListener("click", closeModal);
$("#cancel-modal").addEventListener("click", closeModal);

$("#quote-form").addEventListener("submit", saveQuote);

$("#add-item").addEventListener("click", () => {
  addItemRow({
    serviceId: null,
    description: "",
    quantity: 1,
    price: 0
  });
});

$("#quote-items-list").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-item");
  if (!button) return;

  button.closest(".quote-item-row").remove();
  updateTotals();
});

$("#quote-discount").addEventListener("input", updateTotals);
$("#quote-search").addEventListener("input", renderQuotes);
$("#status-filter").addEventListener("change", renderQuotes);

$("#quote-modal").addEventListener("click", (event) => {
  if (event.target === $("#quote-modal")) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#quote-modal").hidden) {
    closeModal();
  }
});

loadData();
