import { pipeline } from "@xenova/transformers";

let embedderPromise: Promise<(input: string) => Promise<number[]>> | null = null;

export const getTextEmbedder = async () => {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const featureExtractor = await pipeline("feature-extraction", "Xenova/multilingual-e5-small");
      return async (input: string): Promise<number[]> => {
        const output = await featureExtractor(input, { pooling: "mean", normalize: true });
        return Array.from(output.data as Float32Array);
      };
    })();
  }

  return embedderPromise;
};

export const embedText = async (input: string): Promise<number[]> => {
  const embedder = await getTextEmbedder();
  return embedder(input);
};
