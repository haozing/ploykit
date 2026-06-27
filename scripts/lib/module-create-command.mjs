import fs from 'node:fs';
import path from 'node:path';

import {
  createUsage,
  MODULE_TEMPLATES,
  TEMPLATES_WITH_DATA_ARTIFACTS,
} from './module-template-catalog.mjs';
import { runLocalScript } from './module-command-execution.mjs';

export function parseCreateArgs(args) {
  let moduleId = null;
  let template = 'app';
  const extensions = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--template' || arg === '--preset' || arg === '-t') {
      template = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--with' || arg === '--extension' || arg === '--extensions') {
      extensions.push(
        ...(args[index + 1] ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      );
      index += 1;
      continue;
    }

    if (!moduleId) {
      moduleId = arg;
      continue;
    }

    if (!arg.startsWith('--')) {
      template = arg;
    }
  }

  return { moduleId, template, extensions: [...new Set(extensions)] };
}

function moduleDisplayName(moduleId) {
  return moduleId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function renderTemplateContent(content, variables) {
  return content
    .replaceAll('__MODULE_ID__', variables.moduleId)
    .replaceAll('__MODULE_NAME__', variables.moduleName);
}

export function copyTemplateDirectory(sourceDir, targetDir, variables) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplateDirectory(source, target, variables);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const content = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(target, renderTemplateContent(content, variables), 'utf8');
  }
}

export function createModuleFromTemplate(options) {
  const { args, projectRoot, getModuleSources, moduleIdPattern, toProjectPath } = options;
  const { moduleId, template, extensions } = parseCreateArgs(args);

  if (!moduleId || !moduleIdPattern.test(moduleId)) {
    throw new Error(createUsage());
  }
  if (!MODULE_TEMPLATES.has(template)) {
    throw new Error(
      `Unknown module template "${template}". Available: ${[...MODULE_TEMPLATES].join(', ')}.`
    );
  }
  if (extensions.length > 0) {
    throw new Error('Module extensions are not part of the clean ordinary template path.');
  }

  const sources = getModuleSources(projectRoot).sources;
  const defaultSource = sources[0];
  if (!defaultSource) {
    throw new Error('No module source is configured in ploykit.config.json.');
  }
  const moduleRoot = path.join(defaultSource.dir, moduleId);
  if (fs.existsSync(moduleRoot)) {
    throw new Error(`Module already exists: ${toProjectPath(moduleRoot)}`);
  }

  const templateRoot = path.join(projectRoot, 'templates', 'modules', template);
  if (!fs.existsSync(templateRoot)) {
    throw new Error(`Template directory is missing: ${toProjectPath(templateRoot)}`);
  }

  const variables = {
    moduleId,
    moduleName: moduleDisplayName(moduleId),
  };

  copyTemplateDirectory(templateRoot, moduleRoot, variables);

  if (TEMPLATES_WITH_DATA_ARTIFACTS.has(template)) {
    runLocalScript(projectRoot, path.join('scripts', 'module-data.mjs'), ['generate', moduleRoot]);
    runLocalScript(projectRoot, path.join('scripts', 'module-data.mjs'), ['types', moduleRoot]);
  }

  runLocalScript(projectRoot, path.join('scripts', 'generate-module-map.mjs'), []);
  runLocalScript(projectRoot, path.join('scripts', 'ploykit-module.mjs'), ['doctor', moduleRoot]);

  return {
    success: true,
    moduleRoot: toProjectPath(moduleRoot),
    template,
    extensions,
    next: [
      `npm run module:doctor -- ${toProjectPath(moduleRoot)}`,
      `npm run module:test -- ${toProjectPath(moduleRoot)}`,
      `npm run module:inspect -- ${toProjectPath(moduleRoot)}`,
      `http://localhost:3000/dashboard/${moduleId}`,
    ],
  };
}
