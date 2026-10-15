// Configuração do backend Supabase.
// A chave "anon" é pública por natureza: todo o acesso aos dados passa por
// funções RPC que validam a sessão (matrícula + CPF) no servidor.
window.CONFIG = {
  SUPABASE_URL: "https://pjbwftyyvgfotadkvmvq.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqYndmdHl5dmdmb3RhZGt2bXZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwOTU4MzYsImV4cCI6MjEwNzY3MTgzNn0.ow5Y_7KUE85rqnME0qERjL1lIrbHFG-wvILUNLtevAc",
  UNIDADE: "CD Drogasil Manaus",
  SETOR: "SESMT",
  FORM_CODIGO: "FO-COR-SEG-001",
  FORM_VERSAO: "04",
  FORM_DATA: "30/04/25",
};
