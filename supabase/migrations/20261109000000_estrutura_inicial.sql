


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."criar_conta_receber"("p_orcamento_id" "uuid", "p_meio_pagamento" "text", "p_parcelas" "jsonb", "p_entrada_recebida" boolean DEFAULT false, "p_meio_pagamento_entrada" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'auth'
    AS $_$
DECLARE
    v_usuario_id UUID;
    v_total_orcamento NUMERIC(14,2);
    v_total_parcelas NUMERIC;
    v_quantidade INTEGER;
    v_quantidade_entradas INTEGER;
    v_registros_invalidos INTEGER;
    v_conta_id UUID;
BEGIN

    -- Usuário autenticado
    v_usuario_id := auth.uid();

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;


    -- Validar meio de pagamento
    IF p_meio_pagamento NOT IN (
        'pix',
        'dinheiro',
        'credito',
        'debito',
        'transferencia',
        'outro'
    ) THEN
        RAISE EXCEPTION 'Meio de pagamento inválido.';
    END IF;


    -- Validar meio de pagamento da entrada, se informado
    IF p_meio_pagamento_entrada IS NOT NULL
       AND p_meio_pagamento_entrada NOT IN (
            'pix',
            'dinheiro',
            'credito',
            'debito',
            'transferencia',
            'outro'
       ) THEN
        RAISE EXCEPTION 'Meio de pagamento da entrada inválido.';
    END IF;


    -- Validar formato das parcelas
    IF p_parcelas IS NULL
       OR jsonb_typeof(p_parcelas) <> 'array' THEN
        RAISE EXCEPTION 'As parcelas devem ser enviadas em formato de lista.';
    END IF;

    v_quantidade := jsonb_array_length(p_parcelas);

    IF v_quantidade < 1 OR v_quantidade > 12 THEN
        RAISE EXCEPTION 'A quantidade deve ser de 1 a 12 parcelas.';
    END IF;


    -- Buscar o total real do orçamento
    SELECT total
    INTO v_total_orcamento
    FROM public.visao_orcamentos
    WHERE orcamento_id = p_orcamento_id
      AND usuario_id = v_usuario_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orçamento não encontrado ou sem permissão de acesso.';
    END IF;

    IF v_total_orcamento <= 0 THEN
        RAISE EXCEPTION 'O orçamento precisa ter um valor total positivo.';
    END IF;


    -- Validar os dados recebidos das parcelas
    SELECT
        COUNT(*),
        COALESCE(SUM(x.valor), 0),
        COUNT(*) FILTER (
            WHERE COALESCE(x.eh_entrada, FALSE)
        ),
        COUNT(*) FILTER (
            WHERE x.numero_parcela IS NULL
               OR x.numero_parcela <> e.ord
               OR x.valor IS NULL
               OR x.valor <= 0
               OR x.valor <> ROUND(x.valor, 2)
               OR x.vencimento_em IS NULL
        )
        +
        COUNT(*) FILTER (
            WHERE COALESCE(x.eh_entrada, FALSE)
              AND x.numero_parcela <> 1
        )
    INTO
        v_quantidade,
        v_total_parcelas,
        v_quantidade_entradas,
        v_registros_invalidos
    FROM jsonb_array_elements(p_parcelas)
         WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS x(
        numero_parcela SMALLINT,
        valor NUMERIC,
        vencimento_em DATE,
        eh_entrada BOOLEAN
    );


    IF v_registros_invalidos > 0 THEN
        RAISE EXCEPTION 'Existem parcelas com dados inválidos ou numeração incorreta.';
    END IF;

    IF v_quantidade_entradas > 1 THEN
        RAISE EXCEPTION 'Só é permitida uma parcela de entrada.';
    END IF;

    IF v_total_parcelas <> v_total_orcamento THEN
        RAISE EXCEPTION
            'A soma das parcelas (R$ %) é diferente do total do orçamento (R$ %).',
            v_total_parcelas,
            v_total_orcamento;
    END IF;

    IF p_entrada_recebida AND v_quantidade_entradas <> 1 THEN
        RAISE EXCEPTION 'Para registrar uma entrada recebida, é necessário cadastrar a parcela de entrada.';
    END IF;


    -- Criar a conta a receber
    INSERT INTO public.contas_receber (
        usuario_id,
        orcamento_id,
        meio_pagamento,
        quantidade_parcelas,
        valor_total
    )
    VALUES (
        v_usuario_id,
        p_orcamento_id,
        p_meio_pagamento,
        v_quantidade,
        v_total_orcamento
    )
    RETURNING id INTO v_conta_id;


    -- Criar todas as parcelas
    INSERT INTO public.parcelas_receber (
        usuario_id,
        conta_id,
        numero_parcela,
        valor,
        vencimento_em,
        eh_entrada
    )
    SELECT
        v_usuario_id,
        v_conta_id,
        x.numero_parcela,
        x.valor,
        x.vencimento_em,
        COALESCE(x.eh_entrada, FALSE)
    FROM jsonb_array_elements(p_parcelas) AS e(item)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS x(
        numero_parcela SMALLINT,
        valor NUMERIC,
        vencimento_em DATE,
        eh_entrada BOOLEAN
    );


    -- Registrar a entrada como recebida, se solicitado
    IF p_entrada_recebida THEN

        INSERT INTO public.recebimentos (
            usuario_id,
            parcela_id,
            valor,
            meio_pagamento,
            data_recebimento,
            observacoes
        )
        SELECT
            v_usuario_id,
            p.id,
            p.valor,
            COALESCE(
                p_meio_pagamento_entrada,
                p_meio_pagamento
            ),
            CURRENT_DATE,
            'Entrada recebida na criação da conta.'
        FROM public.parcelas_receber p
        WHERE p.conta_id = v_conta_id
          AND p.eh_entrada = TRUE;

    END IF;


    -- Retornar o ID da conta criada
    RETURN v_conta_id;

END;
$_$;


ALTER FUNCTION "public"."criar_conta_receber"("p_orcamento_id" "uuid", "p_meio_pagamento" "text", "p_parcelas" "jsonb", "p_entrada_recebida" boolean, "p_meio_pagamento_entrada" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."excluir_execucao"("p_execucao_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    v_usuario_id uuid;
    v_excluidas integer;
BEGIN
    v_usuario_id := auth.uid();

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- Exclui primeiro todos os itens da execução.
    DELETE FROM public.itens_execucao
    WHERE execucao_id = p_execucao_id
      AND usuario_id = v_usuario_id;

    -- Depois exclui o registro principal.
    DELETE FROM public.execucoes_servico
    WHERE id = p_execucao_id
      AND usuario_id = v_usuario_id;

    GET DIAGNOSTICS v_excluidas = ROW_COUNT;

    IF v_excluidas = 0 THEN
        RAISE EXCEPTION 'Execução não encontrada ou sem permissão para excluí-la.';
    END IF;
END;
$$;


ALTER FUNCTION "public"."excluir_execucao"("p_execucao_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_execucao_orcamento"("p_cliente_id" "uuid", "p_orcamento_id" "uuid", "p_data_execucao" "date", "p_observacoes" "text", "p_modo" "text", "p_item_orcamento_id" "uuid" DEFAULT NULL::"uuid", "p_quantidade" numeric DEFAULT NULL::numeric) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    v_usuario_id uuid;
    v_execucao_id uuid;
    v_quantidade_orcada numeric(12,3);
    v_quantidade_executada numeric(12,3);
    v_quantidade_restante numeric(12,3);
    v_itens_inseridos integer;
BEGIN
    v_usuario_id := auth.uid();

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    IF p_modo IS NULL
       OR p_modo NOT IN ('parcial', 'integral') THEN
        RAISE EXCEPTION 'Modo de execução inválido.';
    END IF;

    IF p_data_execucao IS NULL
       OR p_data_execucao > CURRENT_DATE THEN
        RAISE EXCEPTION 'Data de execução inválida.';
    END IF;

    PERFORM 1
    FROM public.orcamentos o
    WHERE o.id = p_orcamento_id
      AND o.usuario_id = v_usuario_id
      AND o.cliente_id = p_cliente_id
      AND o.status = 'aprovado'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Orçamento não encontrado, não pertence ao cliente ou não está aprovado.';
    END IF;

    INSERT INTO public.execucoes_servico (
        usuario_id,
        cliente_id,
        orcamento_id,
        data_execucao,
        origem,
        observacoes
    )
    VALUES (
        v_usuario_id,
        p_cliente_id,
        p_orcamento_id,
        p_data_execucao,
        'orcamento',
        NULLIF(BTRIM(p_observacoes), '')
    )
    RETURNING id INTO v_execucao_id;

    IF p_modo = 'parcial' THEN

        IF p_item_orcamento_id IS NULL
           OR p_quantidade IS NULL
           OR p_quantidade <= 0 THEN
            RAISE EXCEPTION
                'Informe o item e uma quantidade válida.';
        END IF;

        SELECT io.quantidade
        INTO v_quantidade_orcada
        FROM public.itens_orcamento io
        WHERE io.id = p_item_orcamento_id
          AND io.orcamento_id = p_orcamento_id
          AND io.usuario_id = v_usuario_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'O item não pertence ao orçamento selecionado.';
        END IF;

        SELECT COALESCE(SUM(ie.quantidade), 0)
        INTO v_quantidade_executada
        FROM public.itens_execucao ie
        WHERE ie.item_orcamento_id = p_item_orcamento_id
          AND ie.usuario_id = v_usuario_id;

        v_quantidade_restante :=
            v_quantidade_orcada - v_quantidade_executada;

        IF p_quantidade > v_quantidade_restante THEN
            RAISE EXCEPTION
                'Quantidade superior ao saldo restante: %.',
                v_quantidade_restante;
        END IF;

        INSERT INTO public.itens_execucao (
            usuario_id,
            execucao_id,
            item_orcamento_id,
            servico_id,
            descricao,
            quantidade,
            preco_unitario
        )
        SELECT
            v_usuario_id,
            v_execucao_id,
            io.id,
            io.servico_id,
            io.descricao,
            p_quantidade,
            io.preco_unitario
        FROM public.itens_orcamento io
        WHERE io.id = p_item_orcamento_id
          AND io.orcamento_id = p_orcamento_id
          AND io.usuario_id = v_usuario_id;

    ELSE

        INSERT INTO public.itens_execucao (
            usuario_id,
            execucao_id,
            item_orcamento_id,
            servico_id,
            descricao,
            quantidade,
            preco_unitario
        )
        SELECT
            v_usuario_id,
            v_execucao_id,
            io.id,
            io.servico_id,
            io.descricao,
            io.quantidade - COALESCE(
                (
                    SELECT SUM(ie.quantidade)
                    FROM public.itens_execucao ie
                    WHERE ie.item_orcamento_id = io.id
                      AND ie.usuario_id = v_usuario_id
                ),
                0
            ),
            io.preco_unitario
        FROM public.itens_orcamento io
        WHERE io.orcamento_id = p_orcamento_id
          AND io.usuario_id = v_usuario_id
          AND io.quantidade > COALESCE(
                (
                    SELECT SUM(ie.quantidade)
                    FROM public.itens_execucao ie
                    WHERE ie.item_orcamento_id = io.id
                      AND ie.usuario_id = v_usuario_id
                ),
                0
          );

        GET DIAGNOSTICS v_itens_inseridos = ROW_COUNT;

        IF v_itens_inseridos = 0 THEN
            RAISE EXCEPTION
                'Não existem itens pendentes para executar neste orçamento.';
        END IF;

    END IF;

    RETURN v_execucao_id;
END;
$$;


ALTER FUNCTION "public"."registrar_execucao_orcamento"("p_cliente_id" "uuid", "p_orcamento_id" "uuid", "p_data_execucao" "date", "p_observacoes" "text", "p_modo" "text", "p_item_orcamento_id" "uuid", "p_quantidade" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_recebimento"("p_parcela_id" "uuid", "p_valor" numeric, "p_meio_pagamento" "text", "p_data_recebimento" "date" DEFAULT CURRENT_DATE, "p_observacoes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
    v_usuario_id UUID;
    v_valor_parcela NUMERIC(14,2);
    v_total_recebido NUMERIC(14,2);
    v_saldo NUMERIC(14,2);
    v_recebimento_id UUID;
BEGIN

    v_usuario_id := auth.uid();

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.';
    END IF;

    -- Validar valor
    IF p_valor IS NULL
       OR p_valor <= 0
       OR p_valor <> ROUND(p_valor, 2) THEN
        RAISE EXCEPTION 'Informe um valor positivo com até duas casas decimais.';
    END IF;

    -- Validar meio de pagamento
    IF p_meio_pagamento NOT IN (
        'pix',
        'dinheiro',
        'credito',
        'debito',
        'transferencia',
        'outro'
    ) THEN
        RAISE EXCEPTION 'Meio de pagamento inválido.';
    END IF;

    IF p_data_recebimento IS NULL THEN
        RAISE EXCEPTION 'Informe a data do recebimento.';
    END IF;

    -- Buscar e bloquear a parcela durante a operação.
    -- Isso evita dois pagamentos simultâneos ultrapassarem o saldo.
    SELECT p.valor
    INTO v_valor_parcela
    FROM public.parcelas_receber p
    WHERE p.id = p_parcela_id
      AND p.usuario_id = v_usuario_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parcela não encontrada ou sem permissão de acesso.';
    END IF;

    -- Somar os recebimentos anteriores
    SELECT COALESCE(SUM(r.valor), 0)
    INTO v_total_recebido
    FROM public.recebimentos r
    WHERE r.parcela_id = p_parcela_id
      AND r.usuario_id = v_usuario_id;

    -- Calcular saldo restante
    v_saldo := ROUND(v_valor_parcela - v_total_recebido, 2);

    IF v_saldo <= 0 THEN
        RAISE EXCEPTION 'Esta parcela já está totalmente recebida.';
    END IF;

    IF p_valor > v_saldo THEN
        RAISE EXCEPTION
            'Valor acima do saldo restante. Saldo disponível: R$ %.',
            v_saldo;
    END IF;

    -- Registrar o recebimento
    INSERT INTO public.recebimentos (
        usuario_id,
        parcela_id,
        valor,
        meio_pagamento,
        data_recebimento,
        observacoes
    )
    VALUES (
        v_usuario_id,
        p_parcela_id,
        p_valor,
        p_meio_pagamento,
        p_data_recebimento,
        NULLIF(TRIM(p_observacoes), '')
    )
    RETURNING id INTO v_recebimento_id;

    RETURN v_recebimento_id;

END;
$_$;


ALTER FUNCTION "public"."registrar_recebimento"("p_parcela_id" "uuid", "p_valor" numeric, "p_meio_pagamento" "text", "p_data_recebimento" "date", "p_observacoes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_item_execucao"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    v_orcamento_id uuid;
    v_item_orcamento_id uuid;
    v_quantidade_orcada numeric(12,3);
    v_quantidade_existente numeric(12,3);
BEGIN
    -- Impedir que um registro existente seja transferido
    -- para outra visita ou outro item orcado.
    IF TG_OP = 'UPDATE' AND (
        NEW.execucao_id IS DISTINCT FROM OLD.execucao_id
        OR NEW.item_orcamento_id
           IS DISTINCT FROM OLD.item_orcamento_id
        OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id
    ) THEN
        RAISE EXCEPTION
            'Para alterar a visita ou o item orcado, remova o registro e cadastre-o novamente.';
    END IF;

    -- Identificar a visita e seu eventual orcamento.
    SELECT e.orcamento_id
      INTO v_orcamento_id
      FROM public.execucoes_servico AS e
     WHERE e.id = CASE
        WHEN TG_OP = 'DELETE' THEN OLD.execucao_id
        ELSE NEW.execucao_id
     END
       AND e.usuario_id = CASE
        WHEN TG_OP = 'DELETE' THEN OLD.usuario_id
        ELSE NEW.usuario_id
     END;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Visita nao encontrada.';
    END IF;

    -- Atendimento sem orcamento nao pode apontar
    -- para um item de orcamento.
    IF v_orcamento_id IS NULL THEN
        IF TG_OP <> 'DELETE'
           AND NEW.item_orcamento_id IS NOT NULL THEN
            RAISE EXCEPTION
                'Atendimento sem orcamento nao pode referenciar item orcado.';
        END IF;

        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- Toda execucao vinculada a um orcamento precisa
    -- identificar qual item esta sendo executado.
    IF TG_OP <> 'DELETE'
       AND NEW.item_orcamento_id IS NULL THEN
        RAISE EXCEPTION
            'Informe o item do orcamento para registrar a execucao.';
    END IF;

    v_item_orcamento_id :=
        CASE WHEN TG_OP = 'DELETE'
             THEN OLD.item_orcamento_id
             ELSE NEW.item_orcamento_id
        END;

    -- Serializar alteracoes do mesmo orcamento.
    PERFORM 1
      FROM public.orcamentos AS o
     WHERE o.id = v_orcamento_id
       AND o.usuario_id = CASE
           WHEN TG_OP = 'DELETE' THEN OLD.usuario_id
           ELSE NEW.usuario_id
       END
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orcamento nao encontrado.';
    END IF;

    -- Confirmar que o item pertence ao mesmo orcamento.
    SELECT io.quantidade
      INTO v_quantidade_orcada
      FROM public.itens_orcamento AS io
     WHERE io.id = v_item_orcamento_id
       AND io.orcamento_id = v_orcamento_id
       AND io.usuario_id = CASE
           WHEN TG_OP = 'DELETE' THEN OLD.usuario_id
           ELSE NEW.usuario_id
       END;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'O item informado nao pertence a este orcamento.';
    END IF;

    -- Exclusao: nao ha nova quantidade a validar.
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    -- Somar execucoes anteriores do mesmo item.
    SELECT COALESCE(SUM(ie.quantidade), 0)
      INTO v_quantidade_existente
      FROM public.itens_execucao AS ie
     WHERE ie.item_orcamento_id = NEW.item_orcamento_id
       AND ie.usuario_id = NEW.usuario_id
       AND ie.id IS DISTINCT FROM NEW.id;

    IF v_quantidade_existente + NEW.quantidade
       > v_quantidade_orcada THEN
        RAISE EXCEPTION
            'Quantidade excede o saldo do item. Orcado: %, ja executado: %, novo registro: %.',
            v_quantidade_orcada,
            v_quantidade_existente,
            NEW.quantidade;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_item_execucao"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."categorias_servicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "descricao" "text",
    "criada_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."categorias_servicos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "telefone" "text",
    "endereco" "text",
    "observacoes" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "arquivado_em" timestamp with time zone,
    "tipo" "text" DEFAULT 'Pessoa física'::"text" NOT NULL,
    "documento" "text",
    "whatsapp" "text",
    "email" "text",
    "numero" "text",
    "complemento" "text",
    "bairro" "text",
    "cidade" "text",
    "estado" "text",
    "cep" "text",
    "data_nascimento" "date",
    CONSTRAINT "clientes_tipo_check" CHECK (("tipo" = ANY (ARRAY['Pessoa física'::"text", 'Pessoa jurídica'::"text"])))
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contas_receber" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "orcamento_id" "uuid" NOT NULL,
    "meio_pagamento" "text" NOT NULL,
    "quantidade_parcelas" smallint NOT NULL,
    "valor_total" numeric(12,2) NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contas_receber_meio_pagamento_check" CHECK (("meio_pagamento" = ANY (ARRAY['pix'::"text", 'dinheiro'::"text", 'credito'::"text", 'debito'::"text", 'transferencia'::"text", 'outro'::"text"]))),
    CONSTRAINT "contas_receber_quantidade_parcelas_check" CHECK ((("quantidade_parcelas" >= 1) AND ("quantidade_parcelas" <= 12))),
    CONSTRAINT "contas_receber_valor_total_check" CHECK (("valor_total" > (0)::numeric))
);


ALTER TABLE "public"."contas_receber" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."execucoes_servico" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "orcamento_id" "uuid",
    "data_execucao" "date" DEFAULT CURRENT_DATE NOT NULL,
    "origem" "text" NOT NULL,
    "observacoes" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "execucoes_servico_check" CHECK (((("origem" = ANY (ARRAY['historico_manual'::"text", 'avulso'::"text"])) AND ("orcamento_id" IS NULL)) OR (("origem" = 'orcamento'::"text") AND ("orcamento_id" IS NOT NULL)))),
    CONSTRAINT "execucoes_servico_origem_check" CHECK (("origem" = ANY (ARRAY['historico_manual'::"text", 'orcamento'::"text", 'avulso'::"text"])))
);


ALTER TABLE "public"."execucoes_servico" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."itens_execucao" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "execucao_id" "uuid" NOT NULL,
    "item_orcamento_id" "uuid",
    "servico_id" "uuid",
    "descricao" "text" NOT NULL,
    "quantidade" numeric(12,3) NOT NULL,
    "preco_unitario" numeric(12,2) NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "itens_execucao_preco_unitario_check" CHECK (("preco_unitario" >= (0)::numeric)),
    CONSTRAINT "itens_execucao_quantidade_check" CHECK (("quantidade" > (0)::numeric))
);


ALTER TABLE "public"."itens_execucao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."itens_orcamento" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "orcamento_id" "uuid" NOT NULL,
    "servico_id" "uuid",
    "descricao" "text" NOT NULL,
    "quantidade" numeric(12,3) NOT NULL,
    "preco_unitario" numeric(12,2) NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "itens_orcamento_preco_unitario_check" CHECK (("preco_unitario" >= (0)::numeric)),
    CONSTRAINT "itens_orcamento_quantidade_check" CHECK (("quantidade" > (0)::numeric))
);


ALTER TABLE "public"."itens_orcamento" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orcamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "numero" bigint NOT NULL,
    "status" "text" DEFAULT 'rascunho'::"text" NOT NULL,
    "desconto" numeric(12,2) DEFAULT 0 NOT NULL,
    "validade_em" "date",
    "observacoes" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "orcamentos_desconto_check" CHECK (("desconto" >= (0)::numeric)),
    CONSTRAINT "orcamentos_status_check" CHECK (("status" = ANY (ARRAY['rascunho'::"text", 'pendente'::"text", 'aprovado'::"text", 'recusado'::"text", 'cancelado'::"text", 'concluido'::"text"])))
);


ALTER TABLE "public"."orcamentos" OWNER TO "postgres";


ALTER TABLE "public"."orcamentos" ALTER COLUMN "numero" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."orcamentos_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."parcelas_receber" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "conta_id" "uuid" NOT NULL,
    "numero_parcela" smallint NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "vencimento_em" "date" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "eh_entrada" boolean DEFAULT false NOT NULL,
    CONSTRAINT "parcelas_receber_numero_parcela_check" CHECK ((("numero_parcela" >= 1) AND ("numero_parcela" <= 12))),
    CONSTRAINT "parcelas_receber_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."parcelas_receber" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recebimentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "parcela_id" "uuid" NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "meio_pagamento" "text" NOT NULL,
    "data_recebimento" "date" DEFAULT CURRENT_DATE NOT NULL,
    "observacoes" "text",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recebimentos_meio_pagamento_check" CHECK (("meio_pagamento" = ANY (ARRAY['pix'::"text", 'dinheiro'::"text", 'credito'::"text", 'debito'::"text", 'transferencia'::"text", 'outro'::"text"]))),
    CONSTRAINT "recebimentos_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."recebimentos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."servicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "categoria_id" "uuid",
    "nome" "text" NOT NULL,
    "descricao" "text",
    "preco_referencia" numeric(12,2) DEFAULT 0 NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "servicos_preco_referencia_check" CHECK (("preco_referencia" >= (0)::numeric))
);


ALTER TABLE "public"."servicos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."visao_parcelas_receber" WITH ("security_invoker"='true') AS
 SELECT "p"."id" AS "parcela_id",
    "p"."usuario_id",
    "p"."conta_id",
    "p"."numero_parcela",
    "p"."eh_entrada",
    "p"."valor",
    "p"."vencimento_em",
    (COALESCE("r"."total_recebido", (0)::numeric))::numeric(14,2) AS "total_recebido",
    ("round"(("p"."valor" - COALESCE("r"."total_recebido", (0)::numeric)), 2))::numeric(14,2) AS "saldo",
        CASE
            WHEN (("p"."valor" - COALESCE("r"."total_recebido", (0)::numeric)) <= (0)::numeric) THEN 'recebida'::"text"
            WHEN ("p"."vencimento_em" < CURRENT_DATE) THEN 'vencida'::"text"
            WHEN (COALESCE("r"."total_recebido", (0)::numeric) > (0)::numeric) THEN 'parcialmente_recebida'::"text"
            ELSE 'em_aberto'::"text"
        END AS "situacao",
    (("p"."vencimento_em" < CURRENT_DATE) AND (("p"."valor" - COALESCE("r"."total_recebido", (0)::numeric)) > (0)::numeric)) AS "esta_vencida"
   FROM ("public"."parcelas_receber" "p"
     LEFT JOIN ( SELECT "recebimentos"."parcela_id",
            "recebimentos"."usuario_id",
            "sum"("recebimentos"."valor") AS "total_recebido"
           FROM "public"."recebimentos"
          GROUP BY "recebimentos"."parcela_id", "recebimentos"."usuario_id") "r" ON ((("r"."parcela_id" = "p"."id") AND ("r"."usuario_id" = "p"."usuario_id"))));


ALTER VIEW "public"."visao_parcelas_receber" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."visao_contas_receber" WITH ("security_invoker"='true') AS
 SELECT "c"."id" AS "conta_id",
    "c"."usuario_id",
    "c"."orcamento_id",
    "o"."numero" AS "numero_orcamento",
    "o"."cliente_id",
    "c"."meio_pagamento",
    "c"."quantidade_parcelas",
    "c"."valor_total",
    "c"."criado_em",
    (COALESCE("sum"("v"."total_recebido"), (0)::numeric))::numeric(14,2) AS "total_recebido",
    ("round"(("c"."valor_total" - COALESCE("sum"("v"."total_recebido"), (0)::numeric)), 2))::numeric(14,2) AS "saldo",
        CASE
            WHEN (("c"."valor_total" - COALESCE("sum"("v"."total_recebido"), (0)::numeric)) <= (0)::numeric) THEN 'recebida'::"text"
            WHEN "bool_or"("v"."esta_vencida") THEN 'vencida'::"text"
            WHEN (COALESCE("sum"("v"."total_recebido"), (0)::numeric) > (0)::numeric) THEN 'parcialmente_recebida'::"text"
            ELSE 'em_aberto'::"text"
        END AS "situacao",
    COALESCE("bool_or"("v"."esta_vencida"), false) AS "possui_parcela_vencida"
   FROM (("public"."contas_receber" "c"
     JOIN "public"."orcamentos" "o" ON ((("o"."id" = "c"."orcamento_id") AND ("o"."usuario_id" = "c"."usuario_id"))))
     LEFT JOIN "public"."visao_parcelas_receber" "v" ON ((("v"."conta_id" = "c"."id") AND ("v"."usuario_id" = "c"."usuario_id"))))
  GROUP BY "c"."id", "c"."usuario_id", "c"."orcamento_id", "o"."numero", "o"."cliente_id", "c"."meio_pagamento", "c"."quantidade_parcelas", "c"."valor_total", "c"."criado_em";


ALTER VIEW "public"."visao_contas_receber" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."visao_execucoes" WITH ("security_invoker"='true') AS
 SELECT "e"."id" AS "execucao_id",
    "e"."usuario_id",
    "e"."cliente_id",
    "e"."orcamento_id",
    "e"."data_execucao",
    "e"."origem",
    "e"."observacoes",
    (COALESCE("sum"(("ie"."quantidade" * "ie"."preco_unitario")), (0)::numeric))::numeric(14,2) AS "valor_total"
   FROM ("public"."execucoes_servico" "e"
     LEFT JOIN "public"."itens_execucao" "ie" ON ((("ie"."execucao_id" = "e"."id") AND ("ie"."usuario_id" = "e"."usuario_id"))))
  GROUP BY "e"."id", "e"."usuario_id", "e"."cliente_id", "e"."orcamento_id", "e"."data_execucao", "e"."origem", "e"."observacoes";


ALTER VIEW "public"."visao_execucoes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."visao_orcamentos" WITH ("security_invoker"='true') AS
 SELECT "o"."id" AS "orcamento_id",
    "o"."usuario_id",
    "o"."cliente_id",
    "o"."numero",
    "o"."status",
    "o"."desconto",
    (COALESCE("sum"(("io"."quantidade" * "io"."preco_unitario")), (0)::numeric))::numeric(14,2) AS "subtotal",
    ((COALESCE("sum"(("io"."quantidade" * "io"."preco_unitario")), (0)::numeric) - "o"."desconto"))::numeric(14,2) AS "total"
   FROM ("public"."orcamentos" "o"
     LEFT JOIN "public"."itens_orcamento" "io" ON ((("io"."orcamento_id" = "o"."id") AND ("io"."usuario_id" = "o"."usuario_id"))))
  GROUP BY "o"."id", "o"."usuario_id", "o"."cliente_id", "o"."numero", "o"."status", "o"."desconto";


ALTER VIEW "public"."visao_orcamentos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."visao_saldo_itens_orcamento" WITH ("security_invoker"='true') AS
 SELECT "io"."id" AS "item_orcamento_id",
    "io"."usuario_id",
    "io"."orcamento_id",
    "io"."descricao",
    "io"."quantidade" AS "quantidade_orcada",
    (COALESCE("sum"("ie"."quantidade"), (0)::numeric))::numeric(12,3) AS "quantidade_executada",
    (("io"."quantidade" - COALESCE("sum"("ie"."quantidade"), (0)::numeric)))::numeric(12,3) AS "quantidade_restante",
    "io"."preco_unitario",
    (("io"."quantidade" * "io"."preco_unitario"))::numeric(14,2) AS "valor_orcado",
    ((COALESCE("sum"("ie"."quantidade"), (0)::numeric) * "io"."preco_unitario"))::numeric(14,2) AS "valor_executado",
    ((("io"."quantidade" - COALESCE("sum"("ie"."quantidade"), (0)::numeric)) * "io"."preco_unitario"))::numeric(14,2) AS "valor_restante"
   FROM ("public"."itens_orcamento" "io"
     LEFT JOIN "public"."itens_execucao" "ie" ON ((("ie"."item_orcamento_id" = "io"."id") AND ("ie"."usuario_id" = "io"."usuario_id"))))
  GROUP BY "io"."id", "io"."usuario_id", "io"."orcamento_id", "io"."descricao", "io"."quantidade", "io"."preco_unitario";


ALTER VIEW "public"."visao_saldo_itens_orcamento" OWNER TO "postgres";


ALTER TABLE ONLY "public"."categorias_servicos"
    ADD CONSTRAINT "categorias_servicos_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."categorias_servicos"
    ADD CONSTRAINT "categorias_servicos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categorias_servicos"
    ADD CONSTRAINT "categorias_servicos_usuario_id_nome_key" UNIQUE ("usuario_id", "nome");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contas_receber"
    ADD CONSTRAINT "contas_receber_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."contas_receber"
    ADD CONSTRAINT "contas_receber_orcamento_id_usuario_id_key" UNIQUE ("orcamento_id", "usuario_id");



ALTER TABLE ONLY "public"."contas_receber"
    ADD CONSTRAINT "contas_receber_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."execucoes_servico"
    ADD CONSTRAINT "execucoes_servico_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."execucoes_servico"
    ADD CONSTRAINT "execucoes_servico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."itens_execucao"
    ADD CONSTRAINT "itens_execucao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."itens_orcamento"
    ADD CONSTRAINT "itens_orcamento_id_orcamento_id_usuario_id_key" UNIQUE ("id", "orcamento_id", "usuario_id");



ALTER TABLE ONLY "public"."itens_orcamento"
    ADD CONSTRAINT "itens_orcamento_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."itens_orcamento"
    ADD CONSTRAINT "itens_orcamento_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orcamentos"
    ADD CONSTRAINT "orcamentos_id_cliente_id_usuario_id_key" UNIQUE ("id", "cliente_id", "usuario_id");



ALTER TABLE ONLY "public"."orcamentos"
    ADD CONSTRAINT "orcamentos_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."orcamentos"
    ADD CONSTRAINT "orcamentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orcamentos"
    ADD CONSTRAINT "orcamentos_usuario_id_numero_key" UNIQUE ("usuario_id", "numero");



ALTER TABLE ONLY "public"."parcelas_receber"
    ADD CONSTRAINT "parcelas_receber_conta_id_numero_parcela_key" UNIQUE ("conta_id", "numero_parcela");



ALTER TABLE ONLY "public"."parcelas_receber"
    ADD CONSTRAINT "parcelas_receber_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."parcelas_receber"
    ADD CONSTRAINT "parcelas_receber_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recebimentos"
    ADD CONSTRAINT "recebimentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."servicos"
    ADD CONSTRAINT "servicos_id_usuario_id_key" UNIQUE ("id", "usuario_id");



ALTER TABLE ONLY "public"."servicos"
    ADD CONSTRAINT "servicos_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_clientes_usuario_nome" ON "public"."clientes" USING "btree" ("usuario_id", "nome");



CREATE INDEX "idx_contas_receber_usuario" ON "public"."contas_receber" USING "btree" ("usuario_id");



CREATE INDEX "idx_execucoes_cliente_data" ON "public"."execucoes_servico" USING "btree" ("usuario_id", "cliente_id", "data_execucao" DESC);



CREATE INDEX "idx_itens_execucao_item_orcamento" ON "public"."itens_execucao" USING "btree" ("usuario_id", "item_orcamento_id");



CREATE INDEX "idx_itens_execucao_visita" ON "public"."itens_execucao" USING "btree" ("usuario_id", "execucao_id");



CREATE INDEX "idx_itens_orcamento_orcamento" ON "public"."itens_orcamento" USING "btree" ("usuario_id", "orcamento_id");



CREATE INDEX "idx_orcamentos_cliente_data" ON "public"."orcamentos" USING "btree" ("usuario_id", "cliente_id", "criado_em" DESC);



CREATE INDEX "idx_parcelas_receber_conta" ON "public"."parcelas_receber" USING "btree" ("usuario_id", "conta_id");



CREATE INDEX "idx_parcelas_receber_vencimento" ON "public"."parcelas_receber" USING "btree" ("usuario_id", "vencimento_em");



CREATE INDEX "idx_recebimentos_parcela" ON "public"."recebimentos" USING "btree" ("usuario_id", "parcela_id");



CREATE OR REPLACE TRIGGER "gatilho_validar_item_execucao" BEFORE INSERT OR DELETE OR UPDATE ON "public"."itens_execucao" FOR EACH ROW EXECUTE FUNCTION "public"."validar_item_execucao"();



ALTER TABLE ONLY "public"."categorias_servicos"
    ADD CONSTRAINT "categorias_servicos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."contas_receber"
    ADD CONSTRAINT "contas_receber_orcamento_id_usuario_id_fkey" FOREIGN KEY ("orcamento_id", "usuario_id") REFERENCES "public"."orcamentos"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contas_receber"
    ADD CONSTRAINT "contas_receber_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."execucoes_servico"
    ADD CONSTRAINT "execucoes_servico_cliente_id_usuario_id_fkey" FOREIGN KEY ("cliente_id", "usuario_id") REFERENCES "public"."clientes"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."execucoes_servico"
    ADD CONSTRAINT "execucoes_servico_orcamento_id_cliente_id_usuario_id_fkey" FOREIGN KEY ("orcamento_id", "cliente_id", "usuario_id") REFERENCES "public"."orcamentos"("id", "cliente_id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."execucoes_servico"
    ADD CONSTRAINT "execucoes_servico_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."itens_execucao"
    ADD CONSTRAINT "itens_execucao_execucao_id_usuario_id_fkey" FOREIGN KEY ("execucao_id", "usuario_id") REFERENCES "public"."execucoes_servico"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."itens_execucao"
    ADD CONSTRAINT "itens_execucao_item_orcamento_id_usuario_id_fkey" FOREIGN KEY ("item_orcamento_id", "usuario_id") REFERENCES "public"."itens_orcamento"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."itens_execucao"
    ADD CONSTRAINT "itens_execucao_servico_id_usuario_id_fkey" FOREIGN KEY ("servico_id", "usuario_id") REFERENCES "public"."servicos"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."itens_execucao"
    ADD CONSTRAINT "itens_execucao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."itens_orcamento"
    ADD CONSTRAINT "itens_orcamento_orcamento_id_usuario_id_fkey" FOREIGN KEY ("orcamento_id", "usuario_id") REFERENCES "public"."orcamentos"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."itens_orcamento"
    ADD CONSTRAINT "itens_orcamento_servico_id_usuario_id_fkey" FOREIGN KEY ("servico_id", "usuario_id") REFERENCES "public"."servicos"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."itens_orcamento"
    ADD CONSTRAINT "itens_orcamento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."orcamentos"
    ADD CONSTRAINT "orcamentos_cliente_id_usuario_id_fkey" FOREIGN KEY ("cliente_id", "usuario_id") REFERENCES "public"."clientes"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."orcamentos"
    ADD CONSTRAINT "orcamentos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."parcelas_receber"
    ADD CONSTRAINT "parcelas_receber_conta_id_usuario_id_fkey" FOREIGN KEY ("conta_id", "usuario_id") REFERENCES "public"."contas_receber"("id", "usuario_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parcelas_receber"
    ADD CONSTRAINT "parcelas_receber_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recebimentos"
    ADD CONSTRAINT "recebimentos_parcela_id_usuario_id_fkey" FOREIGN KEY ("parcela_id", "usuario_id") REFERENCES "public"."parcelas_receber"("id", "usuario_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recebimentos"
    ADD CONSTRAINT "recebimentos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."servicos"
    ADD CONSTRAINT "servicos_categoria_id_usuario_id_fkey" FOREIGN KEY ("categoria_id", "usuario_id") REFERENCES "public"."categorias_servicos"("id", "usuario_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."servicos"
    ADD CONSTRAINT "servicos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



CREATE POLICY "categorias_acesso_proprio" ON "public"."categorias_servicos" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."categorias_servicos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_acesso_proprio" ON "public"."clientes" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."contas_receber" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contas_receber_acesso_proprio" ON "public"."contas_receber" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "execucoes_acesso_proprio" ON "public"."execucoes_servico" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."execucoes_servico" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."itens_execucao" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "itens_execucao_acesso_proprio" ON "public"."itens_execucao" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."itens_orcamento" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "itens_orcamento_acesso_proprio" ON "public"."itens_orcamento" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."orcamentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orcamentos_acesso_proprio" ON "public"."orcamentos" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."parcelas_receber" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "parcelas_receber_acesso_proprio" ON "public"."parcelas_receber" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."recebimentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recebimentos_acesso_proprio" ON "public"."recebimentos" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."servicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "servicos_acesso_proprio" ON "public"."servicos" TO "authenticated" USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."criar_conta_receber"("p_orcamento_id" "uuid", "p_meio_pagamento" "text", "p_parcelas" "jsonb", "p_entrada_recebida" boolean, "p_meio_pagamento_entrada" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."criar_conta_receber"("p_orcamento_id" "uuid", "p_meio_pagamento" "text", "p_parcelas" "jsonb", "p_entrada_recebida" boolean, "p_meio_pagamento_entrada" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."criar_conta_receber"("p_orcamento_id" "uuid", "p_meio_pagamento" "text", "p_parcelas" "jsonb", "p_entrada_recebida" boolean, "p_meio_pagamento_entrada" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."excluir_execucao"("p_execucao_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."excluir_execucao"("p_execucao_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."excluir_execucao"("p_execucao_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_execucao_orcamento"("p_cliente_id" "uuid", "p_orcamento_id" "uuid", "p_data_execucao" "date", "p_observacoes" "text", "p_modo" "text", "p_item_orcamento_id" "uuid", "p_quantidade" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_execucao_orcamento"("p_cliente_id" "uuid", "p_orcamento_id" "uuid", "p_data_execucao" "date", "p_observacoes" "text", "p_modo" "text", "p_item_orcamento_id" "uuid", "p_quantidade" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_execucao_orcamento"("p_cliente_id" "uuid", "p_orcamento_id" "uuid", "p_data_execucao" "date", "p_observacoes" "text", "p_modo" "text", "p_item_orcamento_id" "uuid", "p_quantidade" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_recebimento"("p_parcela_id" "uuid", "p_valor" numeric, "p_meio_pagamento" "text", "p_data_recebimento" "date", "p_observacoes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_recebimento"("p_parcela_id" "uuid", "p_valor" numeric, "p_meio_pagamento" "text", "p_data_recebimento" "date", "p_observacoes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_recebimento"("p_parcela_id" "uuid", "p_valor" numeric, "p_meio_pagamento" "text", "p_data_recebimento" "date", "p_observacoes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_item_execucao"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_item_execucao"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_item_execucao"() TO "service_role";



GRANT ALL ON TABLE "public"."categorias_servicos" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."categorias_servicos" TO "authenticated";



GRANT ALL ON TABLE "public"."clientes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."clientes" TO "authenticated";



GRANT ALL ON TABLE "public"."contas_receber" TO "anon";
GRANT ALL ON TABLE "public"."contas_receber" TO "authenticated";
GRANT ALL ON TABLE "public"."contas_receber" TO "service_role";



GRANT ALL ON TABLE "public"."execucoes_servico" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."execucoes_servico" TO "authenticated";



GRANT ALL ON TABLE "public"."itens_execucao" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."itens_execucao" TO "authenticated";



GRANT ALL ON TABLE "public"."itens_orcamento" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."itens_orcamento" TO "authenticated";



GRANT ALL ON TABLE "public"."orcamentos" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."orcamentos" TO "authenticated";



GRANT USAGE,UPDATE ON SEQUENCE "public"."orcamentos_numero_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orcamentos_numero_seq" TO "service_role";



GRANT ALL ON TABLE "public"."parcelas_receber" TO "anon";
GRANT ALL ON TABLE "public"."parcelas_receber" TO "authenticated";
GRANT ALL ON TABLE "public"."parcelas_receber" TO "service_role";



GRANT ALL ON TABLE "public"."recebimentos" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."recebimentos" TO "authenticated";
GRANT ALL ON TABLE "public"."recebimentos" TO "service_role";



GRANT ALL ON TABLE "public"."servicos" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."servicos" TO "authenticated";



GRANT ALL ON TABLE "public"."visao_parcelas_receber" TO "anon";
GRANT ALL ON TABLE "public"."visao_parcelas_receber" TO "authenticated";
GRANT ALL ON TABLE "public"."visao_parcelas_receber" TO "service_role";



GRANT ALL ON TABLE "public"."visao_contas_receber" TO "anon";
GRANT ALL ON TABLE "public"."visao_contas_receber" TO "authenticated";
GRANT ALL ON TABLE "public"."visao_contas_receber" TO "service_role";



GRANT ALL ON TABLE "public"."visao_execucoes" TO "service_role";
GRANT SELECT ON TABLE "public"."visao_execucoes" TO "authenticated";



GRANT ALL ON TABLE "public"."visao_orcamentos" TO "service_role";
GRANT SELECT ON TABLE "public"."visao_orcamentos" TO "authenticated";



GRANT ALL ON TABLE "public"."visao_saldo_itens_orcamento" TO "service_role";
GRANT SELECT ON TABLE "public"."visao_saldo_itens_orcamento" TO "authenticated";






















