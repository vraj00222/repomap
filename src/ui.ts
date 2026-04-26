import chalk from 'chalk';

const PREFIX = chalk.dim('repomap');

export function info(msg: string): void {
  console.log(`${PREFIX} ${msg}`);
}

export function success(msg: string): void {
  console.log(`${PREFIX} ${chalk.green('✓')} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${PREFIX} ${chalk.yellow('⚠')} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${PREFIX} ${chalk.red('✗')} ${msg}`);
}

export function note(msg: string): void {
  console.log(chalk.dim(`  ${msg}`));
}
