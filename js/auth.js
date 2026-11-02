
(async () => {
  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error || !data.session) {
      window.location.replace("login.html");
    }
  } catch (error) {
    console.error("Erro ao verificar autenticação:", error);
    window.location.replace("login.html");
  }
})();

// Logout
document.addEventListener("DOMContentLoaded", () => {
  const logoutButton = document.getElementById("logout-button");

  if (!logoutButton) return;

  logoutButton.addEventListener("click", async () => {
    const confirmar = confirm("Deseja realmente sair do sistema?");

    if (!confirmar) return;

    logoutButton.disabled = true;

    try {
      const { error } = await supabaseClient.auth.signOut();

      if (error) {
        throw error;
      }

      window.location.replace("login.html");

    } catch (error) {
      console.error("Erro ao sair:", error);
      alert("Não foi possível encerrar a sessão. Tente novamente.");
      logoutButton.disabled = false;
    }
  });
});
