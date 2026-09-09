// Muda o tipo da pergunta "Endereço" de Q28 de "Texto aberto" para o novo tipo
// "Endereço", que ativa a busca em cascata de ruas no Pulso Campo.
//
// Uso: PULSO_ADMIN_USER=... PULSO_ADMIN_PASSWORD=... node scripts/set-address-question-type.mjs --write

import { loginAdminAndGetState, isWriteMode, syncAdminState } from "./pulso-admin-client.mjs";

const TARGET_ID = "BON012_Q28_ENDERECO";

async function main() {
  const write = isWriteMode();
  const { token, state } = await loginAdminAndGetState();

  const target = state.questions.find((q) => q.id === TARGET_ID);
  if (!target) throw new Error(`Pergunta não encontrada: ${TARGET_ID}`);
  console.log("antes:", { id: target.id, type: target.type });

  const nextQuestions = state.questions.map((q) =>
    q.id === TARGET_ID ? { ...q, type: "Endereço" } : q,
  );

  if (!write) {
    console.log("\n--dry-run (padrão): nada foi gravado. Rode com --write para gravar de fato.");
    return;
  }

  await syncAdminState(token, state.researches, nextQuestions);
  console.log("\nGravado com sucesso: tipo agora é 'Endereço'.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
