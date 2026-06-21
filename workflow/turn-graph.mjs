import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';

export const TurnState = Annotation.Root({
  workflowRunId: Annotation({ default: () => '' }),
  sessionId: Annotation({ default: () => '' }),
  mode: Annotation({ default: () => 'chat' }),
  input: Annotation({ default: () => null }),
  output: Annotation({ default: () => null }),
  status: Annotation({ default: () => 'idle' }),
  error: Annotation({ default: () => null }),
  metadata: Annotation({ default: () => ({}) }),
});

export class LangGraphTurnEngine {
  constructor({ checkpointer = new MemorySaver() } = {}) {
    this.checkpointer = checkpointer;
  }

  async run(input, executor) {
    if (!input?.workflowRunId) throw new Error('workflowRunId is required');
    if (typeof executor !== 'function') throw new Error('turn executor is required');
    const executeTurn = async (state) => {
      try {
        const output = await executor(state.input, state);
        return { output, status: 'completed', error: null };
      } catch (error) {
        return { status: 'error', error: String(error?.message || error) };
      }
    };
    const graph = new StateGraph(TurnState)
      .addNode('execute_turn', executeTurn, { retryPolicy: { maxAttempts: 1 } })
      .addEdge(START, 'execute_turn')
      .addEdge('execute_turn', END)
      .compile({ checkpointer: this.checkpointer, name: `myteam-${input.mode || 'turn'}-workflow` });
    const config = {
      configurable: { thread_id: String(input.workflowRunId) },
      recursionLimit: 20,
    };
    await graph.invoke({ ...input, status: 'running', error: null }, config);
    const snapshot = await graph.getState(config);
    if (snapshot.values.status === 'error') throw new Error(snapshot.values.error || 'turn workflow failed');
    return snapshot.values;
  }
}
