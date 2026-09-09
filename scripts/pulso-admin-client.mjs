// Client Supabase e helpers compartilhados pelos scripts administrativos do
// Pulso Eleitoral (scripts/*.mjs). Antes cada script duplicava o mesmo bloco
// de createClient + login admin + guarda --write/dry-run; agora fica só aqui.
//
// Observação: scripts rodam com "node scripts/arquivo.mjs" puro, sem loader
// de TypeScript, então não podem importar src/lib/supabase.ts diretamente —
// por isso a URL/chave do Supabase ficam duplicadas nos dois lugares. Se a
// chave anon (sb_publishable_...) for rotacionada, atualize os dois arquivos.

import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://brfqhqxphrwnhxudpluc.supabase.co",
  "sb_publishable_Ga-W8ulvjrvhmvmgSrDc_w_exV1oDZn",
);

// Lê PULSO_ADMIN_USER/PULSO_ADMIN_PASSWORD do ambiente, autentica como admin
// e já retorna o estado atual (pesquisas + perguntas) na mesma chamada.
export async function loginAdminAndGetState() {
  const username = process.env.PULSO_ADMIN_USER;
  const password = process.env.PULSO_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("Defina PULSO_ADMIN_USER e PULSO_ADMIN_PASSWORD no ambiente.");
  }

  const { data: login, error: loginError } = await supabase.rpc("pulso_admin_login", {
    p_username: username,
    p_password: password,
  });
  if (loginError) throw loginError;
  if (!login?.token) throw new Error("Login inválido: usuário/senha incorretos.");

  const { data: state, error: stateError } = await supabase.rpc("pulso_admin_get_state", {
    p_token: login.token,
  });
  if (stateError) throw stateError;

  return { token: login.token, state };
}

// Todo script de escrita segue a mesma convenção: por padrão roda em modo
// dry-run (só imprime o que seria gravado); só grava de fato com --write.
export function isWriteMode() {
  return process.argv.includes("--write");
}

// Grava pesquisas/perguntas via pulso_admin_sync_state (sobrescreve os dois
// arrays inteiros — sempre monte `researches`/`questions` a partir do estado
// atual retornado por loginAdminAndGetState, nunca de um array vazio).
export async function syncAdminState(token, researches, questions) {
  const { error } = await supabase.rpc("pulso_admin_sync_state", {
    p_token: token,
    p_researches: researches,
    p_questions: questions,
  });
  if (error) throw error;
}

// Mesmo algoritmo de geração de login usado no painel admin
// (src/App.tsx, função slugifyLogin) — mantenha os dois em sincronia.
export const slugifyLogin = (name) =>
  name
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(".") || "agente";

// Mesmo algoritmo de geração de senha usado no painel admin (generateAgentPassword).
export const generateAgentPassword = () => Math.random().toString(36).slice(-6);
