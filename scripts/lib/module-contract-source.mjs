import fs from 'node:fs';
import path from 'node:path';

export const PART_EXPECTED_EXPORTS = {
  data: /\bexport\s+(const|default)\s+\w*data|\bexport\s*{\s*\w+\s+as\s+data|\bdata\s*:/,
  routes: /\bexport\s+(const|default)\s+\w*routes|\bexport\s*{\s*\w+\s+as\s+routes|\broutes\s*:/,
  presentation:
    /\bexport\s+(const|default)\s+\w*presentation|\bexport\s*{\s*\w+\s+as\s+presentation|\bpresentation\s*:/,
  theme: /\bexport\s+(const|default)\s+\w*theme|\bexport\s*{\s*\w+\s+as\s+theme|\btheme\s*:/,
  i18n: /\bexport\s+(const|default)\s+\w*i18n|\bexport\s*{\s*\w+\s+as\s+i18n|\bi18n\s*:/,
};

export function extractString(source, key) {
  return source.match(new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`))?.[1] ?? '';
}

export function normalizeLocalModulePath(moduleRoot, localPath) {
  const withoutPrefix = localPath.replace(/^\.\//, '');
  const absoluteBase = path.resolve(moduleRoot, withoutPrefix);
  const candidates = [
    absoluteBase,
    `${absoluteBase}.ts`,
    `${absoluteBase}.tsx`,
    `${absoluteBase}.js`,
    `${absoluteBase}.jsx`,
    path.join(absoluteBase, 'index.ts'),
    path.join(absoluteBase, 'index.tsx'),
    path.join(absoluteBase, 'index.js'),
    path.join(absoluteBase, 'index.jsx'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? absoluteBase;
}

export function extractLocalPaths(source) {
  const paths = new Set();
  const pattern = /['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of source.matchAll(pattern)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

export function extractHandlerPaths(source) {
  const paths = new Set();
  const pattern = /\bhandler\s*:\s*['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of source.matchAll(pattern)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

export function extractAllContractLocalPaths(source) {
  return [
    ...new Set([
      ...extractLocalPaths(source),
      ...extractContractParts(source).map((part) => part.localPath),
    ]),
  ].sort();
}

export function extractPublicAliases(source) {
  const aliases = [];
  const publicAliasesPattern = /\bpublicAliases\s*:\s*\[([\s\S]*?)\]/g;
  for (const aliasesMatch of source.matchAll(publicAliasesPattern)) {
    const valuesSource = aliasesMatch[1];
    const stringPattern = /['"`]([^'"`]+)['"`]/g;
    for (const valueMatch of valuesSource.matchAll(stringPattern)) {
      aliases.push(valueMatch[1]);
    }
  }
  return aliases;
}

export function extractStringArray(source, key) {
  const values = [];
  const arraySource = source.match(new RegExp(`\\b${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  if (!arraySource) {
    return values;
  }

  for (const match of arraySource.matchAll(/['"`]([^'"`]+)['"`]/g)) {
    values.push(match[1]);
  }
  return values;
}

export function extractDefineModuleObject(source) {
  const match = /\bdefineModule\s*\(\s*{/.exec(source);
  if (!match) {
    return '';
  }
  const start = match.index + match[0].lastIndexOf('{');
  const end = findMatchingDelimiter(source, start, '{', '}');
  return end >= 0 ? source.slice(start, end + 1) : '';
}

export function findTopLevelKeyArraySource(source, key) {
  const body = source.startsWith('{') && source.endsWith('}') ? source.slice(1, -1) : source;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;
  let escaped = false;
  const keyPattern = new RegExp(`^\\s*(?:${key}|['"\`]${key}['"\`])\\s*:\\s*\\[`);

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      const match = keyPattern.exec(body.slice(index));
      if (match) {
        const start = index + match[0].lastIndexOf('[');
        const end = findMatchingDelimiter(body, start, '[', ']');
        return end >= 0 ? body.slice(start + 1, end) : '';
      }
    }

    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    }
  }

  return '';
}

export function extractTopLevelStringArray(source, key) {
  const values = [];
  const moduleObject = extractDefineModuleObject(source);
  const arraySource = findTopLevelKeyArraySource(moduleObject || source, key);
  if (!arraySource) {
    return values;
  }

  for (const match of arraySource.matchAll(/['"`]([^'"`]+)['"`]/g)) {
    values.push(match[1]);
  }
  return values;
}

export function originForUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function extractStaticHttpFetchOrigins(source) {
  const origins = [];
  for (const match of source.matchAll(/\bctx\.http\.fetch\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    const origin = originForUrl(match[1]);
    if (origin) {
      origins.push(origin);
    }
  }
  return origins;
}

export function extractContractParts(source) {
  const partsSource = extractObjectAfterKey(source, 'parts');
  if (!partsSource) {
    return [];
  }
  const entries = [];
  for (const match of partsSource.matchAll(
    /\b(data|routes|presentation|theme|i18n)\s*:\s*['"`](\.\/[^'"`]+)['"`]/g
  )) {
    entries.push({ part: match[1], localPath: match[2] });
  }
  return entries;
}

export function findKeyArraySource(source, key) {
  const keyMatch = new RegExp(`\\b${key}\\s*:\\s*\\[`).exec(source);
  if (!keyMatch) {
    return '';
  }

  const start = keyMatch.index + keyMatch[0].lastIndexOf('[');
  const end = findMatchingDelimiter(source, start, '[', ']');
  return end >= 0 ? source.slice(start + 1, end) : '';
}

export function findMatchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export function extractObjectLiterals(source) {
  const objects = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '{') {
      continue;
    }
    const end = findMatchingDelimiter(source, index, '{', '}');
    if (end < 0) {
      break;
    }
    objects.push(source.slice(index, end + 1));
    index = end;
  }
  return objects;
}

export function extractRouteObjects(source, group) {
  const block = findKeyArraySource(source, group);
  return block ? extractObjectLiterals(block) : [];
}

export function hasStringProperty(source, key, value) {
  return new RegExp(`\\b${key}\\s*:\\s*['"\`]${value}['"\`]`).test(source);
}

export function extractObjectAfterKey(source, key) {
  const keyMatch = new RegExp(`\\b${key}\\s*:\\s*{`).exec(source);
  if (!keyMatch) {
    return '';
  }
  const start = keyMatch.index + keyMatch[0].lastIndexOf('{');
  const end = findMatchingDelimiter(source, start, '{', '}');
  return end >= 0 ? source.slice(start, end + 1) : '';
}

export function extractConstObject(source, name) {
  const assignment = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*{`).exec(source);
  if (!assignment) {
    return '';
  }
  const start = assignment.index + assignment[0].lastIndexOf('{');
  const end = findMatchingDelimiter(source, start, '{', '}');
  return end >= 0 ? source.slice(start, end + 1) : '';
}

export function resolveAnonymousPolicySource(routeObject, moduleSource) {
  const inline = extractObjectAfterKey(routeObject, 'anonymousPolicy');
  if (inline) {
    return inline;
  }
  return /\banonymousPolicy\s*,/.test(routeObject)
    ? extractConstObject(moduleSource, 'anonymousPolicy')
    : '';
}
