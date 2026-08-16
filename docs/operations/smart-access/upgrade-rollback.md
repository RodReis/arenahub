# Runbook — Atualização e rollback

**Para quem:** operador técnico.
**Quando:** release novo do Edge ou da nuvem.

> ⚠️ **Não ensaiado.** A Task 6 do plano de F11 exige ensaio real de rollback com outbox
> pendente, e ele **não aconteceu** — a bancada estava indisponível. Ver §5.

---

## 1. Regra que não se negocia

**O contrato suporta a versão atual e a imediatamente anterior** (`MVP-01` §19, ADR-011). Isso
existe para que o rollback seja possível: se a nuvem exigisse só a versão nova, voltar o Edge
para N-1 quebraria a comunicação e o rollback viraria uma segunda falha.

**Consequência prática:** a nuvem sobe **antes** do Edge, e nunca remove campo que o Edge N-1
ainda envia.

---

## 2. Janela

Atualize **fora do horário de pico**. Durante a troca, a catraca fica alguns segundos sem
decidir — e sem operação offline (ADR-012), isso é catraca parada.

A recepção precisa saber que vai liberar manualmente durante a janela.

---

## 3. Atualização da nuvem

1. Migração de banco **expand** primeiro: acrescenta coluna, nunca remove
2. Deploy da API
3. `pnpm smoke:smart-access` — todas as linhas `[OK]`
4. Só depois, em release futuro, a migração **contract** que remove o que ficou órfão

> **Nunca expand e contract no mesmo deploy.** É isso que torna o rollback possível: se a API
> nova falhar, a antiga ainda encontra as colunas que espera.

---

## 4. Atualização do Edge

1. Confirme no painel que o Edge está **Respondendo**
2. Pare o serviço `ArenaHub Edge`
3. Instale a versão nova
4. Inicie o serviço
5. Confirme no painel: **Respondendo**, com a versão nova
6. Teste uma passagem real (aluno com plano, aluno sem plano)

**O SQLite não é apagado.** Ele guarda a fila de eventos que ainda não subiram — apagá-lo
descarta passagem já registrada.

---

## 5. Rollback do Edge

**Quando:** a versão nova não sobe, ou sobe e decide errado.

1. Pare o serviço
2. Reinstale a versão anterior
3. **Preserve o SQLite e a credencial** — o rollback não repara identidade
4. Inicie e confirme no painel
5. Confira a fila: eventos gerados durante a janela precisam subir

### ⬜ O ensaio que falta

A Task 6 exige, e **não foi feito**:

- [ ] Com outbox pendente, atualizar N→N+1, gerar evento, voltar para N e reconciliar
- [ ] Confirmar que nenhum evento se perdeu nem duplicou
- [ ] Execução por pessoa **diferente** de quem escreveu este runbook

Sem esse ensaio, o rollback é procedimento plausível, não procedimento verificado. **Não conte
com ele numa emergência antes de testá-lo em ambiente controlado.**

---

## 6. Rollback da nuvem

O rollback da nuvem **nunca remove coluna ou evento** que um Edge ativo ainda usa. Se a migração
nova removeu algo, o rollback não é reverter a migração — é subir a API anterior contra o schema
novo, que ainda tem tudo que ela espera.

Por isso a regra do §3: **expand e contract em releases separados**.

---

## 7. Backup e restauração

⬜ **Não ensaiado.** A Task 6 exige restaurar um backup em ambiente isolado, rodar migrações e
comparar contagens de tenant, entitlement e evento — registrando RPO e RTO alcançados.

**Nunca ensaie restauração sobre produção.**

Enquanto o ensaio não acontecer, o `M1-NFR-005` (RPO de 24 h, RTO documentado) **não está
verificado** — está declarado.
