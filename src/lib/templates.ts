/**
 * Email templates: {{path.to.value}}, {{#if field == "value"}}…{{/if}},
 * {{#if field}}…{{/if}} and {{#each list}}…{{/each}}. Small on purpose:
 * organisers can read every rule on one screen.
 */
export type Ctx = Record<string, unknown>;

function lookup(ctx: Ctx, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Ctx)[k] : undefined), ctx);
}

export function render(template: string, ctx: Ctx): string {
  let out = template.replace(/\{\{#each ([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, path: string, body: string) => {
    const list = lookup(ctx, path);
    return Array.isArray(list) ? list.map((item) => render(body, { ...ctx, ...(item as Ctx) })).join('') : '';
  });
  out = out.replace(/\{\{#if ([\w.]+)(?:\s*==\s*"([^"]*)")?\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, path: string, eq: string | undefined, body: string) => {
    const v = lookup(ctx, path);
    const pass = eq === undefined ? !!v && v !== '' : String(v) === eq;
    return pass ? render(body, ctx) : '';
  });
  return out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path: string) => {
    const v = lookup(ctx, path);
    return v === undefined || v === null ? m : String(v);
  });
}

/** Variables a template uses that this context cannot fill. */
export function missingVars(template: string, ctx: Ctx): string[] {
  const filled = render(template, ctx);
  return [...new Set([...filled.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
}
