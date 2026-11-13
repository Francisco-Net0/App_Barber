# Agendamento online para barbearia

Aplicação mobile-first em React/Vite, com Supabase (Postgres, Auth e RLS) e função serverless da Vercel para a WhatsApp Cloud API.

## Preparar o Supabase

1. Em um projeto novo, execute `supabase/schema.sql`, `supabase/admin_booking_update.sql`, `supabase/production_hardening.sql` e `supabase/customer_accounts.sql`, nessa ordem, no SQL Editor.
2. Em uma instalação existente, execute `supabase/admin_booking_update.sql`, `supabase/production_hardening.sql` e `supabase/customer_accounts.sql`. Não reaplique o schema inicial em uma base com dados.
3. Crie o usuário do barbeiro em **Authentication > Users** e associe-o à tabela de administradores:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'EMAIL_DO_BARBEIRO';
   ```

4. Configure a barbearia, os serviços, os horários e a equipe pelo painel autenticado em `/admin`. A migração cria o barbeiro inicial “Barbeiro principal”; ajuste o nome ou cadastre outros na aba **Equipe**. O banco começa sem serviços e com os dias fechados; configure e confira tudo antes de divulgar o link.

Clientes podem criar conta em `/login`. No agendamento, as escolhas são preservadas enquanto entram ou se cadastram; reservas, alterações e cancelamentos são validados no banco e limitados ao cliente autenticado. Cada barbeiro tem seus próprios conflitos de horário. As funções de disponibilidade retornam somente períodos ocupados e bloqueios sem notas internas.

## Executar e publicar

1. Copie `.env.example` para `.env.local` e informe a URL raiz do projeto Supabase e a chave pública (anon/publishable). Nunca use a service role ou tokens privados em variáveis `VITE_*`.
2. Execute `npm install` e `npm run dev`. Para testar a função `/api/notify` localmente, use `vercel dev`; o servidor Vite sozinho não executa funções serverless.
3. Publique na Vercel, configure as variáveis de ambiente em todos os ambientes necessários e associe o domínio próprio. A reescrita de rotas do `vercel.json` mantém as páginas React acessíveis diretamente.
4. Faça login em `/admin`, confira a agenda e cadastre a identidade, preços, duração, funcionamento, endereço e contatos reais antes de liberar o endereço do site.
5. Se a confirmação de e-mail estiver habilitada no Supabase, inclua o domínio publicado e `http://localhost:5173/**` na lista de URLs de redirecionamento autorizadas do Auth. A confirmação retorna ao login e continua o fluxo de agendamento.

## WhatsApp

`api/notify.js` usa a WhatsApp Cloud API oficial. Configure no servidor:

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_API_VERSION`
- `WA_TEMPLATE_CLIENT`, `WA_TEMPLATE_BARBER` e `BARBER_WHATSAPP`

Crie e aprove os modelos transacionais em português (`pt_BR`) com estes parâmetros de corpo, nesta ordem:

- Modelo do cliente: nome do cliente, serviços, data, horário, valor e nome da barbearia.
- Modelo do barbeiro: nome do cliente, serviços, data, horário e valor.

Sem essas configurações, o agendamento continua salvo e a tela informa claramente que o envio não está configurado. Cada reserva recebe uma única tentativa automática para evitar mensagens duplicadas; se a API falhar durante o envio, confira o status na Meta e entre em contato manualmente antes de qualquer reenvio.

## Acesso e dados

- A rota `/admin` exige sessão autenticada e associação à tabela `admins`; as operações são protegidas também pelas políticas RLS. A área `/cliente` e as RPCs de cliente usam a identidade autenticada para limitar acesso aos próprios dados e agendamentos.
- Dados de clientes e reservas não são consultáveis anonimamente. Os dados públicos de disponibilidade incluem somente os períodos ocupados, sem dados pessoais.
- Configure o período de funcionamento e revise as variáveis externas, políticas e usuários no Supabase antes do lançamento.
