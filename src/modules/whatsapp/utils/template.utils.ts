/**
 * Utility functions for template processing
 */

/**
 * Replace variables in template content
 * @param content - Template content with variables like {{name}}, {{company}}
 * @param variables - Object containing variable values
 * @returns Processed content with variables replaced
 */
export function replaceTemplateVariables(
    content: string,
    variables: Record<string, string> = {}
): string {
    let processedContent = content;

    // Replace each variable in the content
    Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'gi');
        processedContent = processedContent.replace(regex, value);
    });

    return processedContent;
}

/**
 * Extract variables from template content
 * @param content - Template content
 * @returns Array of variable names found in the template
 */
export function extractTemplateVariables(content: string): string[] {
    const variableRegex = /{{(\w+)}}/g;
    const variables: string[] = [];
    let match;

    while ((match = variableRegex.exec(content)) !== null) {
        if (!variables.includes(match[1])) {
            variables.push(match[1]);
        }
    }

    return variables;
}

/**
 * Validate if all required variables are provided
 * @param content - Template content
 * @param variables - Provided variables
 * @returns Object with validation result and missing variables
 */
export function validateTemplateVariables(
    content: string,
    variables: Record<string, string> = {}
): { isValid: boolean; missingVariables: string[] } {
    const requiredVariables = extractTemplateVariables(content);
    const providedVariables = Object.keys(variables);
    const missingVariables = requiredVariables.filter(
        variable => !providedVariables.includes(variable)
    );

    return {
        isValid: missingVariables.length === 0,
        missingVariables
    };
} 