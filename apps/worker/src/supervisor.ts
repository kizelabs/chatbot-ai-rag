const delays = [1000, 2000, 5000, 10000, 30000];

export const nextDelay = (attempt: number): number => delays[Math.min(attempt, delays.length - 1)];

export const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
