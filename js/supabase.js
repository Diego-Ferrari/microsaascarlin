
const SUPABASE_URL = "https://jgldohjeervovrrkgahn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JXoMIj05Kj6v3H-7bkjc-g_oILhXtjk";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// Acrescentando temporariamente - Retirar futuramente essa parte do código, por favor!!

console.log("Biblioteca Supabase:", typeof window.supabase);
console.log("Cliente Supabase:", typeof supabaseClient);

supabaseClient.auth.getSession()
  .then(({ data, error }) => {
    if (error) {
      console.error("Erro ao testar Supabase:", error.message);
      return;
    }

    console.log("Supabase inicializado!");
    console.log("Sessão ativa:", Boolean(data.session));
  })
  .catch((error) => {
    console.error("Falha na inicialização:", error);
  });