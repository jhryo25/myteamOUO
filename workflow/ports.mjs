const noop = () => {};

export function createWorkflowPorts(input = {}) {
  const required = ['executeTask', 'reviewTask', 'transitionTask'];
  for (const name of required) {
    if (typeof input[name] !== 'function') {
      throw new Error(`workflow port ${name} is required`);
    }
  }
  return Object.freeze({
    executeTask: input.executeTask,
    reviewTask: input.reviewTask,
    transitionTask: input.transitionTask,
    materializeSpawns: typeof input.materializeSpawns === 'function'
      ? input.materializeSpawns
      : async () => [],
    applyClarification: typeof input.applyClarification === 'function'
      ? input.applyClarification
      : async (task) => task,
    emit: typeof input.emit === 'function' ? input.emit : noop,
    onWorkflowComplete: typeof input.onWorkflowComplete === 'function'
      ? input.onWorkflowComplete
      : noop,
  });
}
