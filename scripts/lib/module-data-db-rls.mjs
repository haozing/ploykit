export function createModuleDataRlsVerifier(input) {
  const { quoteString, readRlsPolicies, readRlsState, pushDbError } = input;

  function stripOuterParentheses(expression) {
    let value = expression.trim();
    while (value.startsWith('(') && value.endsWith(')')) {
      let depth = 0;
      let wrapped = true;
      for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === '(') {
          depth += 1;
        } else if (char === ')') {
          depth -= 1;
          if (depth === 0 && index < value.length - 1) {
            wrapped = false;
            break;
          }
        }
        if (depth < 0) {
          wrapped = false;
          break;
        }
      }
      if (!wrapped || depth !== 0) {
        break;
      }
      value = value.slice(1, -1).trim();
    }
    return value;
  }

  function normalizePolicyExpression(expression) {
    return stripOuterParentheses(
      String(expression ?? '')
        .replace(/\s+/g, '')
        .replace(/::text/g, '')
        .toLowerCase()
    );
  }

  function policyExpressionHasAll(expression, fragments) {
    const normalized = normalizePolicyExpression(expression);
    return fragments.every((fragment) => normalized.includes(normalizePolicyExpression(fragment)));
  }

  function expectedModuleDocumentScopePolicyFragments() {
    return {
      usingFragments: [
        `product_id = current_setting('ploykit.product_id', true)`,
        `module_id = current_setting('ploykit.module_id', true)`,
        `scope_type = 'public-read'`,
        `scope_type = current_setting('ploykit.scope_type', true)`,
        `scope_id = current_setting('ploykit.scope_id', true)`,
      ],
      withCheckFragments: [
        `product_id = current_setting('ploykit.product_id', true)`,
        `module_id = current_setting('ploykit.module_id', true)`,
        `scope_type = 'public-read'`,
        `scope_id is null`,
        `current_setting('ploykit.allow_public_write', true) = 'true'`,
        `scope_type = current_setting('ploykit.scope_type', true)`,
        `scope_id = current_setting('ploykit.scope_id', true)`,
      ],
    };
  }

  function expectedModuleTableScopePolicyFragments(moduleId) {
    return {
      usingFragments: [
        `product_id = current_setting('ploykit.product_id', true)`,
        `module_id = ${quoteString(moduleId)}`,
        `scope_type = 'public-read'`,
        `scope_type = current_setting('ploykit.scope_type', true)`,
        `scope_id = current_setting('ploykit.scope_id', true)`,
      ],
      withCheckFragments: [
        `product_id = current_setting('ploykit.product_id', true)`,
        `module_id = ${quoteString(moduleId)}`,
        `scope_type = 'public-read'`,
        `scope_id is null`,
        `current_setting('ploykit.allow_public_write', true) = 'true'`,
        `scope_type = current_setting('ploykit.scope_type', true)`,
        `scope_id = current_setting('ploykit.scope_id', true)`,
      ],
    };
  }

  async function verifyRlsTable(
    pool,
    diagnostics,
    schema,
    tableName,
    policyName,
    pathValue,
    expectedExpressions
  ) {
    const rls = await readRlsState(pool, schema, tableName);
    if (!rls?.relrowsecurity || !rls?.relforcerowsecurity) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_RLS_DISABLED',
        `Table "${schema}.${tableName}" must have RLS enabled and forced.`,
        pathValue,
        'Run npm run data:migrate.'
      );
    }

    const policies = await readRlsPolicies(pool, schema, tableName);
    const policy = policies.find((row) => row.policyname === policyName);
    if (!policy) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_RLS_POLICY_MISSING',
        `RLS policy "${policyName}" is missing on "${schema}.${tableName}".`,
        pathValue,
        'Regenerate and apply the module migration.'
      );
      return;
    }

    const unexpectedPolicies = policies
      .filter((row) => row.policyname !== policyName)
      .map((row) => row.policyname);
    if (unexpectedPolicies.length > 0) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_RLS_POLICY_EXTRA',
        `Unexpected RLS policies exist on "${schema}.${tableName}": ${unexpectedPolicies.join(', ')}.`,
        pathValue,
        'Remove the extra policy or regenerate the module migration.',
        { expected: [policyName], actual: policies.map((row) => row.policyname) }
      );
    }

    if (String(policy.cmd ?? '').toUpperCase() !== 'ALL') {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_RLS_POLICY_COMMAND_MISMATCH',
        `RLS policy "${policyName}" on "${schema}.${tableName}" must apply to ALL commands.`,
        pathValue,
        'Regenerate and apply the module migration.',
        { expected: 'ALL', actual: policy.cmd }
      );
    }

    const actualUsing = normalizePolicyExpression(policy.qual);
    const actualWithCheck = normalizePolicyExpression(policy.with_check);

    if (!policyExpressionHasAll(policy.qual, expectedExpressions.usingFragments)) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_RLS_POLICY_USING_MISMATCH',
        `RLS policy "${policyName}" on "${schema}.${tableName}" has an unexpected USING expression.`,
        pathValue,
        'Regenerate and apply the module migration.',
        { expected: expectedExpressions.usingFragments, actual: actualUsing }
      );
    }

    if (!policyExpressionHasAll(policy.with_check, expectedExpressions.withCheckFragments)) {
      pushDbError(
        diagnostics,
        'MODULE_DATA_DB_RLS_POLICY_WITH_CHECK_MISMATCH',
        `RLS policy "${policyName}" on "${schema}.${tableName}" has an unexpected WITH CHECK expression.`,
        pathValue,
        'Regenerate and apply the module migration.',
        { expected: expectedExpressions.withCheckFragments, actual: actualWithCheck }
      );
    }
  }

  return {
    expectedModuleDocumentScopePolicyFragments,
    expectedModuleTableScopePolicyFragments,
    normalizePolicyExpression,
    verifyRlsTable,
  };
}
