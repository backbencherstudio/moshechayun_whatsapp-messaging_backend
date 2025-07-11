export function renderTemplate(content: string, variables: Record<string, string>): string {
    return content.replace(/{{(.*?)}}/g, (_, key) => variables[key.trim()] || '');
}
