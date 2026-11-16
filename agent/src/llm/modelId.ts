// The Claude API names a model with a dashed version (claude-sonnet-5-5); Bankr's LLM gateway lists and returns the
// same model with a dotted one (claude-sonnet-5.5). A model with no minor version (claude-sonnet-5) is the same in both.

/** The gateway's form of a Claude API model id: claude-opus-4-8 -> claude-opus-4.8. Any other name is returned as is. */
export const dottedModelId = (id: string): string => id.replace(/^(claude-[a-z]+-\d+)-(\d+)$/, "$1.$2");

/** The Claude API's form of a gateway model id: claude-opus-4.8 -> claude-opus-4-8. Any other name is returned as is. */
export const dashedModelId = (id: string): string => id.replace(/^(claude-[a-z]+-\d+)\.(\d+)$/, "$1-$2");
