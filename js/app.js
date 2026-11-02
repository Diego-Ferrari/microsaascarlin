
document.addEventListener("DOMContentLoaded", () => {
  const menuLinks = document.querySelectorAll(".menu-link[data-page]");
  const actionButtons = document.querySelectorAll(".action-card[data-page]");
  const pageTitle = document.querySelector("#page-title");

  const pages = {
    inicio: {
      title: "Visão geral",
      url: "index.html"
    },
    clientes: {
      title: "Clientes",
      url: "clientes.html"
    },
    servicos: {
      title: "Serviços",
      url: "servicos.html"
    },
    orcamentos: {
      title: "Orçamentos",
      url: "orcamentos.html"
    },
    execucoes: {
      title: "Execuções",
      url: "execucoes.html"
    }
  };

  function navigateToPage(element) {
    const page = element.dataset.page;
    const destination = pages[page];

    if (!destination) return;

    window.location.href = destination.url;
  }

  menuLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const page = link.dataset.page;

      if (!pages[page]) return;

      event.preventDefault();
      navigateToPage(link);
    });
  });

  actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      navigateToPage(button);
    });
  });

  // Marca a página atual no menu lateral.
  const currentPage = window.location.pathname
    .split("/")
    .pop() || "index.html";

  const currentPageKey = Object.keys(pages).find(
    (key) => pages[key].url === currentPage
  );

  if (currentPageKey) {
    menuLinks.forEach((link) => {
      link.classList.toggle(
        "active",
        link.dataset.page === currentPageKey
      );
    });

    if (pageTitle) {
      pageTitle.textContent = pages[currentPageKey].title;
    }
  }
});
