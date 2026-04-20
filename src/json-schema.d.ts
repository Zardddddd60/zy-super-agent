declare module 'json-schema' {
  export type JSONSchema7Definition = JSONSchema7 | boolean;

  export interface JSONSchema7 {
    $id?: string;
    $ref?: string;
    $schema?: string;
    $comment?: string;
    type?: string | string[];
    const?: unknown;
    enum?: unknown[];
    multipleOf?: number;
    maximum?: number;
    exclusiveMaximum?: number;
    minimum?: number;
    exclusiveMinimum?: number;
    maxLength?: number;
    minLength?: number;
    pattern?: string;
    items?: JSONSchema7Definition | JSONSchema7Definition[];
    additionalItems?: JSONSchema7Definition;
    maxItems?: number;
    minItems?: number;
    uniqueItems?: boolean;
    contains?: JSONSchema7Definition;
    maxProperties?: number;
    minProperties?: number;
    required?: string[];
    properties?: Record<string, JSONSchema7Definition>;
    patternProperties?: Record<string, JSONSchema7Definition>;
    additionalProperties?: JSONSchema7Definition;
    dependencies?: Record<string, JSONSchema7Definition | string[]>;
    propertyNames?: JSONSchema7Definition;
    if?: JSONSchema7Definition;
    then?: JSONSchema7Definition;
    else?: JSONSchema7Definition;
    allOf?: JSONSchema7Definition[];
    anyOf?: JSONSchema7Definition[];
    oneOf?: JSONSchema7Definition[];
    not?: JSONSchema7Definition;
    format?: string;
    contentMediaType?: string;
    contentEncoding?: string;
    definitions?: Record<string, JSONSchema7Definition>;
    default?: unknown;
    examples?: unknown[];
    title?: string;
    description?: string;
    readOnly?: boolean;
    writeOnly?: boolean;
    [key: string]: unknown;
  }
}
