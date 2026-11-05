/**
 * SentencePiece-style tokenizer for the Universal Sentence Encoder Lite vocabulary.
 *
 * Ported from @tensorflow-models/universal-sentence-encoder 1.2.2
 * (src/tokenizer/index.ts, src/tokenizer/trie.ts, src/util.ts).
 * Copyright 2019 Google LLC. Licensed under the Apache License, Version 2.0.
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Changes: converted to a single TypeScript module. commonPrefixSearch takes a
 * start index instead of a sliced copy of the input, which makes long texts
 * faster to encode. Output is unchanged.
 */

/** [piece, score] pairs. The first 6 entries are reserved symbols. */
export type Vocabulary = Array<[string, number]>;

type TrieWord = [string[], number, number]; // [chars, score, index]

const SEPARATOR = "▁";
const RESERVED_SYMBOLS_COUNT = 6;

function stringToChars(input: string): string[] {
  const symbols: string[] = [];
  for (const symbol of input) symbols.push(symbol);
  return symbols;
}

class TrieNode {
  children: Record<string, TrieNode> = {};
  end = false;
  word: TrieWord = [[], 0, 0];
}

class Trie {
  private root = new TrieNode();

  insert(word: string, score: number, index: number) {
    let node = this.root;
    const symbols = stringToChars(word);
    for (let i = 0; i < symbols.length; i++) {
      if (!node.children[symbols[i]]) {
        const child = new TrieNode();
        child.word[0] = node.word[0].concat(symbols[i]);
        node.children[symbols[i]] = child;
      }
      node = node.children[symbols[i]];
      if (i === symbols.length - 1) {
        node.end = true;
        node.word[1] = score;
        node.word[2] = index;
      }
    }
  }

  /** Vocabulary words that are prefixes of `ss` starting at `start`. */
  commonPrefixSearch(ss: string[], start: number): TrieWord[] {
    const output: TrieWord[] = [];
    let node: TrieNode | undefined = this.root.children[ss[start]];
    for (let i = start; i < ss.length && node; i++) {
      if (node.end) output.push(node.word);
      node = node.children[ss[i + 1]];
    }
    if (!output.length) output.push([[ss[start]], 0, 0]);
    return output;
  }
}

export class Tokenizer {
  private trie = new Trie();

  constructor(private vocabulary: Vocabulary) {
    for (let i = RESERVED_SYMBOLS_COUNT; i < vocabulary.length; i++) {
      this.trie.insert(vocabulary[i][0], vocabulary[i][1], i);
    }
  }

  encode(input: string): number[] {
    const symbols = stringToChars(SEPARATOR + input.normalize("NFKC").replace(/ /g, SEPARATOR));
    const nodes: Array<Record<number, Array<{ key: string[]; score: number; index: number }>>> = [];
    const words: number[] = [];
    const best: number[] = [];
    for (let i = 0; i <= symbols.length; i++) {
      nodes.push({});
      words.push(0);
      best.push(0);
    }

    for (let i = 0; i < symbols.length; i++) {
      for (const [key, score, index] of this.trie.commonPrefixSearch(symbols, i)) {
        const endPos = i + key.length;
        (nodes[endPos][i] ??= []).push({ key, score, index });
      }
    }

    for (let endPos = 0; endPos <= symbols.length; endPos++) {
      for (const startPos in nodes[endPos]) {
        for (const word of nodes[endPos][startPos]) {
          const score = word.score + best[endPos - word.key.length];
          if (best[endPos] === 0 || score >= best[endPos]) {
            best[endPos] = score;
            words[endPos] = word.index;
          }
        }
      }
    }

    const results: number[] = [];
    let iter = words.length - 1;
    while (iter > 0) {
      results.push(words[iter]);
      iter -= this.vocabulary[words[iter]][0].length;
    }

    // Collapse runs of unknown tokens (id 0) into one.
    const merged: number[] = [];
    let isPreviousUnk = false;
    for (const id of results) {
      if (!(isPreviousUnk && id === 0)) merged.push(id);
      isPreviousUnk = id === 0;
    }
    return merged.reverse();
  }
}
