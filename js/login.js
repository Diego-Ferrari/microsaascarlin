
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const loginButton = document.querySelector("#login-button");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginError.hidden = true;
  loginError.textContent = "";

  loginButton.disabled = true;
  loginButton.textContent = "Entrando...";

  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw error;
    }

    window.location.replace("index.html");
  } catch (error) {
    console.error("Erro no login:", error.message);

    loginError.textContent =
      "Não foi possível entrar. Confira o e-mail e a senha e tente novamente.";
    loginError.hidden = false;
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Entrar no sistema";
  }
});

// Se já estiver autenticado, não precisa voltar ao login.
supabaseClient.auth.getSession().then(({ data, error }) => {
  if (!error && data.session) {
    window.location.replace("index.html");
  }
});
