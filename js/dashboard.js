
document.addEventListener("DOMContentLoaded", async () => {
  const $ = (selector) => document.querySelector(selector);

  const formatMoney = (value) =>
    Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

  function showError(error) {
    console.error("Erro ao carregar o dashboard:", error);

    $("#dashboard-clients").textContent = "—";
    $("#dashboard-pending-quotes").textContent = "—";
    $("#dashboard-executions").textContent = "—";
    $("#dashboard-pending-value").textContent = "—";
    $("#dashboard-received").textContent = "—";
  }

  try {
    const {
      data: { user },
      error: authError
    } = await supabaseClient.auth.getUser();

    if (authError) throw authError;

    if (!user) {
      window.location.replace("login.html");
      return;
    }

    // 1. Clientes ativos
    const { count: clientCount, error: clientsError } =
      await supabaseClient
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", user.id)
        .is("arquivado_em", null);

    if (clientsError) throw clientsError;

    // 2. Orçamentos pendentes
    const { data: pendingQuotes, error: quotesError } =
      await supabaseClient
        .from("orcamentos")
        .select("id, desconto")
        .eq("usuario_id", user.id)
        .eq("status", "pendente");

    if (quotesError) throw quotesError;

    // 3. Período do mês atual
    const now = new Date();

    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );

    const nextMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1
    );

    const toISODate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");

      return `${year}-${month}-${day}`;
    };

    const startDate = toISODate(monthStart);
    const endDate = toISODate(nextMonthStart);

    // 4. Atendimentos realizados neste mês
    const { data: monthlyExecutions, error: executionsError } =
      await supabaseClient
        .from("execucoes_servico")
        .select("id")
        .eq("usuario_id", user.id)
        .gte("data_execucao", startDate)
        .lt("data_execucao", endDate);

    if (executionsError) throw executionsError;

    const executions = monthlyExecutions ?? [];

    // 5. Valor recebido neste mês
    // Considera como recebido o valor dos serviços executados.
    let receivedValue = 0;

    if (executions.length > 0) {
      const executionIds = executions.map(
        (execution) => execution.id
      );

      const { data: executionItems, error: executionItemsError } =
        await supabaseClient
          .from("itens_execucao")
          .select("quantidade, preco_unitario")
          .eq("usuario_id", user.id)
          .in("execucao_id", executionIds);

      if (executionItemsError) throw executionItemsError;

      receivedValue = (executionItems ?? []).reduce(
        (total, item) => {
          return total +
            Number(item.quantidade) *
            Number(item.preco_unitario);
        },
        0
      );
    }

    // 6. Valor total dos orçamentos pendentes
    let pendingValue = 0;

    if (pendingQuotes.length > 0) {
      const quoteIds = pendingQuotes.map(
        (quote) => quote.id
      );

      const { data: quoteItems, error: itemsError } =
        await supabaseClient
          .from("itens_orcamento")
          .select("orcamento_id, quantidade, preco_unitario")
          .eq("usuario_id", user.id)
          .in("orcamento_id", quoteIds);

      if (itemsError) throw itemsError;

      const totals = new Map();

      for (const item of quoteItems ?? []) {
        const current = totals.get(item.orcamento_id) || 0;

        totals.set(
          item.orcamento_id,
          current +
            Number(item.quantidade) *
            Number(item.preco_unitario)
        );
      }

      pendingValue = pendingQuotes.reduce((total, quote) => {
        const quoteTotal = totals.get(quote.id) || 0;

        return total + Math.max(
          0,
          quoteTotal - Number(quote.desconto || 0)
        );
      }, 0);
    }

    // 7. Atualiza os indicadores
    $("#dashboard-clients").textContent =
      String(clientCount ?? 0);

    $("#dashboard-pending-quotes").textContent =
      String(pendingQuotes.length);

    $("#dashboard-executions").textContent =
      String(executions.length);

    $("#dashboard-pending-value").textContent =
      formatMoney(pendingValue);

    $("#dashboard-received").textContent =
      formatMoney(receivedValue);

  } catch (error) {
    showError(error);
  }
});
