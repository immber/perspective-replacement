// Model labels to Perspective attribute names.
// Unverified: label names come from the model weights; confirm once they are downloaded.
export const ATTRIBUTE_TO_LABEL = {
  TOXICITY: "toxicity",
  SEVERE_TOXICITY: "severe_toxicity",
  INSULT: "insult",
  PROFANITY: "obscene",
  THREAT: "threat",
  IDENTITY_ATTACK: "identity_attack",
} as const;

export type Attribute = keyof typeof ATTRIBUTE_TO_LABEL;
