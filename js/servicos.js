
const serviceForm = document.querySelector("#service-form");
const categoryForm = document.querySelector("#category-form");
const serviceList = document.querySelector("#service-list");

let services = [];
let categories = [];
let editingServiceId = null;

const money = (value) =>
  Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

function mostrarErro(mensagem, erro) {
  console.error(mensagem, erro);
  alert(mensagem);
}

async function obterUsuario() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error) throw error;

  if (!data.user) {
    window.location.replace("login.html");
    throw new Error("Usuário não autenticado.");
  }

  return data.user;
}

function abrirModal(id) {
  document.querySelector(`#${id}`).hidden = false;
  document.body.style.overflow = "hidden";
}

function fecharModal(id) {
  document.querySelector(`#${id}`).hidden = true;

  const modaisFechados = [
    ...document.querySelectorAll(".modal-backdrop")
  ].every((modal) => modal.hidden);

  if (modaisFechados) {
    document.body.style.overflow = "";
  }
}

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    fecharModal(button.dataset.close);
  });
});

document.querySelectorAll(".modal-backdrop").forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) fecharModal(modal.id);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelectorAll(".modal-backdrop").forEach((modal) => {
      if (!modal.hidden) fecharModal(modal.id);
    });
  }
});

document
  .querySelector("#new-service")
  .addEventListener("click", () => abrirFormularioServico());

document
  .querySelector("#empty-new-service")
  .addEventListener("click", () => abrirFormularioServico());

document.querySelector("#new-category").addEventListener("click", () => {
  categoryForm.reset();
  abrirModal("category-modal");
  categoryForm.elements.nome.focus();
});

// ================================
// CARREGAMENTO DOS DADOS
// ================================

async function carregarCategorias() {
  const { data, error } = await supabaseClient
    .from("categorias_servicos")
    .select("id, nome, descricao")
    .order("nome", { ascending: true });

  if (error) throw error;

  categories = data ?? [];
}

async function carregarServicos() {
  const { data, error } = await supabaseClient
    .from("servicos")
    .select("id, categoria_id, nome, descricao, preco_referencia, ativo")
    .order("nome", { ascending: true });

  if (error) throw error;

  services = (data ?? []).map((servico) => ({
    id: servico.id,
    nome: servico.nome,
    categoriaId: servico.categoria_id ?? "",
    descricao: servico.descricao ?? "",
    preco: Number(servico.preco_referencia),
    ativo: servico.ativo
  }));
}

async function carregarDados() {
  try {
    await obterUsuario();

    await Promise.all([
      carregarCategorias(),
      carregarServicos()
    ]);

    render();
  } catch (error) {
    mostrarErro(
      "Não foi possível carregar os serviços e as categorias.",
      error
    );
  }
}

// ================================
// FORMULÁRIO DE SERVIÇO
// ================================

function abrirFormularioServico(servico = null) {
  serviceForm.reset();
  editingServiceId = servico?.id ?? null;

  atualizarSeletoresCategorias();

  if (servico) {
    serviceForm.elements.nome.value = servico.nome;
    serviceForm.elements.categoria.value = servico.categoriaId || "";
    serviceForm.elements.descricao.value = servico.descricao;
    serviceForm.elements.preco.value = servico.preco;

    document.querySelector("#service-modal-title").textContent =
      "Editar serviço";
  } else {
    document.querySelector("#service-modal-title").textContent =
      "Novo serviço";
  }

  serviceForm.querySelector('[type="submit"]').textContent =
    servico ? "Salvar alterações" : "Salvar serviço";

  abrirModal("service-modal");
  serviceForm.elements.nome.focus();
}

serviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const botao = serviceForm.querySelector('[type="submit"]');
  const textoOriginal = botao.textContent;

  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    const usuario = await obterUsuario();

    const nome = serviceForm.elements.nome.value.trim();
    const descricao = serviceForm.elements.descricao.value.trim();
    const categoriaId = serviceForm.elements.categoria.value || null;
    const preco = Number(serviceForm.elements.preco.value);

    if (!nome) {
      alert("Informe o nome do serviço.");
      return;
    }

    if (!Number.isFinite(preco) || preco < 0) {
      alert("Informe um preço válido.");
      return;
    }

    const dados = {
      usuario_id: usuario.id,
      nome,
      categoria_id: categoriaId,
      descricao: descricao || null,
      preco_referencia: preco
    };

    if (editingServiceId !== null) {
      const { error } = await supabaseClient
        .from("servicos")
        .update({
          nome: dados.nome,
          categoria_id: dados.categoria_id,
          descricao: dados.descricao,
          preco_referencia: dados.preco_referencia
        })
        .eq("id", editingServiceId)
        .eq("usuario_id", usuario.id);

      if (error) throw error;
    } else {
      const { error } = await supabaseClient
        .from("servicos")
        .insert(dados);

      if (error) throw error;
    }

    fecharModal("service-modal");
    await carregarDados();
  } catch (error) {
    mostrarErro(
      "Não foi possível salvar o serviço. Confira os dados e tente novamente.",
      error
    );
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
});

// ================================
// FORMULÁRIO DE CATEGORIA
// ================================

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const botao = categoryForm.querySelector('[type="submit"]');
  const textoOriginal = botao.textContent;

  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    const usuario = await obterUsuario();
    const nome = categoryForm.elements.nome.value.trim();

    if (!nome) {
      alert("Informe o nome da categoria.");
      return;
    }

    const duplicada = categories.some(
      (categoria) =>
        categoria.nome.toLowerCase() === nome.toLowerCase()
    );

    if (duplicada) {
      alert("Essa categoria já existe.");
      return;
    }

    const { error } = await supabaseClient
      .from("categorias_servicos")
      .insert({
        usuario_id: usuario.id,
        nome
      });

    if (error) throw error;

    fecharModal("category-modal");
    categoryForm.reset();
    await carregarDados();
  } catch (error) {
    if (error.code === "23505") {
      mostrarErro(
        "Essa categoria já existe no banco de dados.",
        error
      );
    } else {
      mostrarErro("Não foi possível salvar a categoria.", error);
    }
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
});

// ================================
// SELETORES DE CATEGORIA
// ================================

function atualizarSeletoresCategorias() {
  const filtro = document.querySelector("#category-filter");
  const seletorServico = document.querySelector("#service-category");

  const filtroSelecionado = filtro.value;
  const categoriaSelecionada = seletorServico.value;

  filtro.replaceChildren(
    new Option("Todas as categorias", "")
  );

  seletorServico.replaceChildren(
    new Option("Sem categoria", "")
  );

  categories.forEach((categoria) => {
    filtro.add(new Option(categoria.nome, categoria.id));
    seletorServico.add(new Option(categoria.nome, categoria.id));
  });

  filtro.value = categories.some(
    (categoria) => categoria.id === filtroSelecionado
  ) ? filtroSelecionado : "";

  seletorServico.value = categories.some(
    (categoria) => categoria.id === categoriaSelecionada
  ) ? categoriaSelecionada : "";
}

// ================================
// CATEGORIAS: EXIBIR E EXCLUIR
// ================================

function renderizarCategorias() {
  const container = document.querySelector("#category-list");
  container.replaceChildren();

  if (categories.length === 0) {
    const mensagem = document.createElement("p");
    mensagem.className = "service-description";
    mensagem.textContent = "Nenhuma categoria cadastrada.";
    container.append(mensagem);
    return;
  }

  categories.forEach((categoria) => {
    const chip = document.createElement("div");
    chip.className = "category-chip";

    const label = document.createElement("span");
    label.textContent = categoria.nome;

    const remover = document.createElement("button");
    remover.type = "button";
    remover.textContent = "×";
    remover.title = "Excluir categoria";
    remover.setAttribute(
      "aria-label",
      `Excluir categoria ${categoria.nome}`
    );

    remover.addEventListener("click", async () => {
      const possuiServicos = services.some(
        (servico) => servico.categoriaId === categoria.id
      );

      if (possuiServicos) {
        alert(
          "Esta categoria está vinculada a um serviço. " +
          "Edite o serviço antes de removê-la."
        );
        return;
      }

      if (!confirm(`Excluir a categoria "${categoria.nome}"?`)) {
        return;
      }

      try {
        const usuario = await obterUsuario();

        const { error } = await supabaseClient
          .from("categorias_servicos")
          .delete()
          .eq("id", categoria.id)
          .eq("usuario_id", usuario.id);

        if (error) throw error;

        await carregarDados();
      } catch (error) {
        mostrarErro(
          "Não foi possível excluir a categoria. " +
          "Ela pode estar vinculada a um serviço.",
          error
        );
      }
    });

    chip.append(label, remover);
    container.append(chip);
  });
}

// ================================
// ATIVAR E DESATIVAR SERVIÇOS
// ================================

async function alternarStatusServico(servico) {
  try {
    const usuario = await obterUsuario();

    const { error } = await supabaseClient
      .from("servicos")
      .update({ ativo: !servico.ativo })
      .eq("id", servico.id)
      .eq("usuario_id", usuario.id);

    if (error) throw error;

    await carregarDados();
  } catch (error) {
    mostrarErro(
      "Não foi possível alterar o status do serviço.",
      error
    );
  }
}

// ================================
// RENDERIZAÇÃO DA TABELA
// ================================

function renderizarServicos() {
  const busca = document
    .querySelector("#service-search")
    .value.trim().toLowerCase();

  const filtroCategoria =
    document.querySelector("#category-filter").value;

  const filtroStatus =
    document.querySelector("#status-filter").value;

  const filtrados = services.filter((servico) => {
    const categoria = categories.find(
      (item) => item.id === servico.categoriaId
    );

    const correspondeBusca =
      servico.nome.toLowerCase().includes(busca) ||
      servico.descricao.toLowerCase().includes(busca);

    const correspondeCategoria =
      !filtroCategoria || servico.categoriaId === filtroCategoria;

    const correspondeStatus =
      filtroStatus === "todos" ||
      (filtroStatus === "ativos" && servico.ativo) ||
      (filtroStatus === "inativos" && !servico.ativo);

    return (
      correspondeBusca &&
      correspondeCategoria &&
      correspondeStatus
    );
  });

  serviceList.replaceChildren();

  filtrados.forEach((servico) => {
    const categoria = categories.find(
      (item) => item.id === servico.categoriaId
    );

    const linha = document.createElement("tr");

    const nomeCelula = document.createElement("td");
    nomeCelula.className = "service-name";
    nomeCelula.textContent = servico.nome;

    if (servico.descricao) {
      const descricao = document.createElement("span");
      descricao.className = "service-description";
      descricao.textContent = servico.descricao;
      nomeCelula.append(descricao);
    }

    const categoriaCelula = document.createElement("td");
    categoriaCelula.textContent = categoria?.nome || "Sem categoria";

    const precoCelula = document.createElement("td");
    precoCelula.className = "service-price";
    precoCelula.textContent = money(servico.preco);

    const statusCelula = document.createElement("td");
    const etiqueta = document.createElement("span");

    etiqueta.className =
      `service-status${servico.ativo ? "" : " inactive"}`;

    etiqueta.textContent = servico.ativo ? "Ativo" : "Inativo";
    statusCelula.append(etiqueta);

    const acoesCelula = document.createElement("td");
    const acoes = document.createElement("div");
    acoes.className = "service-actions";

    const editar = document.createElement("button");
    editar.type = "button";
    editar.textContent = "Editar";
    editar.addEventListener("click", () => {
      abrirFormularioServico(servico);
    });

    const alternar = document.createElement("button");
    alternar.type = "button";
    alternar.textContent = servico.ativo ? "Desativar" : "Ativar";
    alternar.addEventListener("click", () => {
      alternarStatusServico(servico);
    });

    acoes.append(editar, alternar);
    acoesCelula.append(acoes);

    linha.append(
      nomeCelula,
      categoriaCelula,
      precoCelula,
      statusCelula,
      acoesCelula
    );

    serviceList.append(linha);
  });

  const vazio = document.querySelector("#service-empty");
  vazio.hidden = filtrados.length > 0;

  document.querySelector(".service-table-wrap").hidden =
    filtrados.length === 0;
}

// ================================
// ATUALIZAÇÃO DA TELA
// ================================

function render() {
  atualizarSeletoresCategorias();
  renderizarCategorias();
  renderizarServicos();

  document.querySelector("#total-services").textContent =
    services.length;

  document.querySelector("#active-services").textContent =
    services.filter((servico) => servico.ativo).length;

  document.querySelector("#total-categories").textContent =
    categories.length;
}

["service-search", "category-filter", "status-filter"].forEach((id) => {
  document.querySelector(`#${id}`).addEventListener(
    id === "service-search" ? "input" : "change",
    renderizarServicos
  );
});

carregarDados();
