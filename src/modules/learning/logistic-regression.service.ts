export interface LogisticTrainingResult {
  weights: number[];
  intercept: number;
  means: number[];
  standardDeviations: number[];
}

export interface LogisticTrainingOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

export function trainLogisticRegression(
  vectors: number[][],
  labels: number[],
  options: LogisticTrainingOptions = {}
): LogisticTrainingResult {
  if (vectors.length === 0 || vectors.length !== labels.length) {
    throw new Error("Training vectors and labels must be non-empty and aligned.");
  }

  const width = vectors[0].length;
  if (width === 0 || vectors.some((vector) => vector.length !== width)) {
    throw new Error("Training vectors must have a consistent non-zero width.");
  }

  const means = Array.from({ length: width }, (_, column) =>
    vectors.reduce((sum, vector) => sum + vector[column], 0) / vectors.length
  );
  const standardDeviations = Array.from({ length: width }, (_, column) => {
    const variance = vectors.reduce(
      (sum, vector) => sum + (vector[column] - means[column]) ** 2,
      0
    ) / vectors.length;
    return Math.sqrt(variance) || 1;
  });
  const normalized = vectors.map((vector) =>
    normalizeVector(vector, means, standardDeviations)
  );
  const positives = labels.reduce((sum, label) => sum + (label === 1 ? 1 : 0), 0);
  const negatives = labels.length - positives;
  const positiveWeight = positives > 0 ? negatives / positives : 1;
  const weights = Array(width).fill(0);
  let intercept = 0;
  const epochs = options.epochs ?? 1_200;
  const learningRate = options.learningRate ?? 0.05;
  const l2 = options.l2 ?? 0.01;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = Array(width).fill(0);
    let interceptGradient = 0;

    normalized.forEach((vector, row) => {
      const label = labels[row];
      const sampleWeight = label === 1 ? positiveWeight : 1;
      const prediction = sigmoid(dot(weights, vector) + intercept);
      const error = (prediction - label) * sampleWeight;
      interceptGradient += error;
      for (let column = 0; column < width; column += 1) {
        weightGradients[column] += error * vector[column];
      }
    });

    for (let column = 0; column < width; column += 1) {
      const gradient =
        weightGradients[column] / vectors.length + l2 * weights[column];
      weights[column] -= learningRate * gradient;
    }
    intercept -= learningRate * interceptGradient / vectors.length;
  }

  return { weights, intercept, means, standardDeviations };
}

export function predictLogisticProbability(
  vector: number[],
  model: LogisticTrainingResult
): number {
  return sigmoid(
    dot(
      model.weights,
      normalizeVector(vector, model.means, model.standardDeviations)
    ) + model.intercept
  );
}

function normalizeVector(
  vector: number[],
  means: number[],
  standardDeviations: number[]
): number[] {
  return vector.map(
    (value, index) => (value - means[index]) / standardDeviations[index]
  );
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function sigmoid(value: number): number {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}
