import YAML from 'yaml';
import {fs} from '@appium/support';
import path from 'node:path';
import {exec} from 'teen_process';
import {Simplify} from 'type-fest';
import {DocutilsError} from './error';
import {createScaffoldTask, ScaffoldTaskOptions} from './init-task';
import logger from './logger';
import {MkDocsYml, TsConfigJson, TypeDocJson} from './types';
import {NAME_TYPEDOC_JSON, stringifyYaml} from './util';

const NAME_MKDOCS_YML = 'mkdocs.yml';
const NAME_TSCONFIG_JSON = 'tsconfig.json';
const NAME_PYTHON = 'python';
/**
 * Data for the base `mkdocs.yml` file
 */
const BASE_MKDOCS_YML: Readonly<MkDocsYml> = Object.freeze({
  INHERIT: './node_modules/@appium/docutils/base-mkdocs.yml',
});

/**
 * Data for the base `typedoc.json` file
 */
const BASE_TYPEDOC_JSON: Readonly<TypeDocJson> = Object.freeze({
  $schema: 'https://typedoc.org/schema.json',
  cleanOutputDir: true,
  entryPointStrategy: 'packages',
  theme: 'appium',
  plugin: [
    '@appium/typedoc-plugin-appium',
    'typedoc-plugin-markdown',
    'typedoc-plugin-resolve-crossmodule-references',
  ],
  readme: 'none',
  entryPoints: ['.'],
});

/**
 * Data for the base `tsconfig.json` file
 */
const BASE_TSCONFIG_JSON: Readonly<TsConfigJson> = Object.freeze({
  $schema: 'https://json.schemastore.org/tsconfig',
  extends: '@appium/tsconfig/tsconfig.json',
  compilerOptions: {
    outDir: 'build',
  },
  include: ['lib', 'src', 'test'],
});

/**
 * Path to the `requirements.txt` file (in this package)
 */
const REQUIREMENTS_TXT_PATH = path.join(fs.findRoot(__dirname), 'requirements.txt');

const log = logger.withTag('init');
const dryRunLog = logger.withTag('dry-run');

/**
 * Function which scaffolds a `tsconfig.json` file
 */
export const initTsConfigJson = createScaffoldTask<InitTsConfigOptions, TsConfigJson>(
  NAME_TSCONFIG_JSON,
  BASE_TSCONFIG_JSON,
  'TypeScript configuration'
);

/**
 * Function which scaffolds a `typedoc.json` file
 */
export const initTypeDocJson = createScaffoldTask<InitTypeDocOptions, TypeDocJson>(
  NAME_TYPEDOC_JSON,
  BASE_TYPEDOC_JSON,
  'TypeDoc configuration'
);

/**
 * Function which scaffolds an `mkdocs.yml` file
 */
export const initMkDocs = createScaffoldTask<InitMkDocsOptions, MkDocsYml>(
  NAME_MKDOCS_YML,
  BASE_MKDOCS_YML,
  'MkDocs configuration',
  {
    deserialize: YAML.parse,
    serialize: stringifyYaml,
    transform: (content, opts, pkg) => {
      let siteName = opts.siteName ?? content.site_name;
      if (!siteName) {
        siteName = pkg.name ?? '(no name)';
        if (siteName) {
          log.info('Using site name from package.json: %s', siteName);
        }
      }
      let repoUrl: string | undefined = opts.repoUrl ?? content.repo_url;
      if (!repoUrl) {
        repoUrl = pkg.repository?.url;
        if (repoUrl) {
          log.info('Using repo URL from package.json: %s', repoUrl);
        }
      }
      let repoName = opts.repoName ?? content.repo_name;
      if (repoUrl && !repoName) {
        let {pathname} = new URL(repoUrl);
        pathname = pathname.slice(1);
        let [owner, repo] = pathname.split('/');
        repo = repo.replace(/\.git$/, '');
        repoName = [owner, repo].join('/');
        if (repoName) {
          log.info('Using repo name from package.json: %s', repoName);
        }
      }
      let siteDescription = opts.siteDescription ?? content.site_description;
      if (!siteDescription) {
        siteDescription = pkg.description;
        if (siteDescription) {
          log.info('Using site description URL from package.json: %s', siteDescription);
        }
      }
      return {
        ...content,
        site_name: siteName,
        repo_url: repoUrl,
        repo_name: repoName,
        site_description: siteDescription,
      };
    },
  }
);

/**
 * Installs Python dependencies
 * @param opts Options
 */
export async function initPython({
  pythonPath = NAME_PYTHON,
  dryRun = false,
}: InitPythonOptions = {}): Promise<void> {
  const args = ['-m', 'pip', 'install', '-r', REQUIREMENTS_TXT_PATH];
  if (dryRun) {
    dryRunLog.info('Would execute command: %s %s', pythonPath, args.join(' '));
  } else {
    log.debug('Executing command: %s %s', pythonPath, args.join(' '));
    log.info('Installing Python dependencies...');
    try {
      const result = await exec(pythonPath, args, {shell: true});
      const {code, stdout} = result;
      if (code !== 0) {
        throw new DocutilsError(`Could not install Python dependencies. Reason: ${stdout}`);
      }
    } catch (err) {
      throw new DocutilsError(
        `Could not install Python dependencies. Reason: ${(err as Error).message}`
      );
    }
  }
  log.success('Installed Python dependencies (or dependencies already installed)');
}

/**
 * Options for {@linkcode initMkDocs}
 */
export interface InitMkDocsOptions extends ScaffoldTaskOptions {
  copyright?: string;
  repoName?: string;
  repoUrl?: string;
  siteDescription?: string;
  siteName?: string;
}

/**
 * Main handler for `init` command.
 *
 * This runs tasks in serial; it _could_ run in parallel, but it has deleterious effects upon
 * console output which would need mitigation.
 */
export async function init({
  typescript,
  typedoc,
  python,
  tsConfigJson: tsConfigJsonPath,
  packageJson: packageJsonPath,
  overwrite,
  include,
  mkdocs,
  mkdocsPath: mkdocsYmlPath,
  siteName,
  repoName,
  repoUrl,
  copyright,
  dryRun,
  cwd,
  pythonPath,
  typedocJson: typedocJsonPath,
}: InitOptions = {}): Promise<void> {
  if (!typescript && typedoc) {
    log.warn(
      'Initialization of tsconfig.json disabled. TypeDoc requires a tsconfig.json; please ensure it exists'
    );
  }

  if (typescript) {
    await initTsConfigJson({
      dest: tsConfigJsonPath,
      packageJson: packageJsonPath,
      overwrite,
      include,
      dryRun,
      cwd,
    });
  }

  if (typedoc) {
    await initTypeDocJson({
      dest: typedocJsonPath,
      packageJson: packageJsonPath,
      overwrite,
      dryRun,
      cwd,
    });
  }

  if (python) {
    await initPython({pythonPath, dryRun});
  }

  if (mkdocs) {
    await initMkDocs({
      dest: mkdocsYmlPath,
      cwd,
      siteName,
      repoUrl,
      repoName,
      copyright,
      packageJson: packageJsonPath,
      overwrite,
      dryRun,
    });
  }
}

export interface InitTypeDocOptions extends ScaffoldTaskOptions {}
export interface InitTsConfigOptions extends ScaffoldTaskOptions {
  /**
   * List of source files (globs supported); typically `src` or `lib`
   */
  include?: string[];
}
export interface InitPythonOptions extends ScaffoldTaskOptions {
  /**
   * Path to `python` (v3.x) executable
   */
  pythonPath?: string;
}

/**
 * Options for `init` command handler
 *
 * The props of the various "path" options are rewritten as `dest` for the scaffold tasks functions.
 */
export type InitOptions = Simplify<
  Omit<InitPythonOptions & InitTsConfigOptions & InitTypeDocOptions & InitMkDocsOptions, 'dest'> & {
    /**
     * If `true` will initialize a `tsconfig.json` file
     */
    typescript?: boolean;
    /**
     * If `true` will initialize a `typedoc.json` file
     */
    typedoc?: boolean;
    /**
     * If `true` will install Python deps
     */
    python?: boolean;
    /**
     * If `true` will initialize a `mkdocs.yml` file
     */
    mkdocs?: boolean;
    /**
     * Path to new or existing `typedoc.json` file
     */
    typedocJson?: string;
    /**
     * Path to new or existing `tsconfig.json` file
     */
    tsConfigJson?: string;
    /**
     * Path to existing `package.json` file
     */
    packageJson?: string;
    /**
     * Path to new or existing `mkdocs.yml` file
     */
    mkdocsPath?: string;
  }
>;