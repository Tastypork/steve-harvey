import { Component, type ReactNode } from 'react';
import { downloadText } from '../game/deck';
import { store } from '../game/store';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Screen crashed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>The board hit a snag</h1>
        <p>Your game is saved after every step. Try the board again, or undo the step that broke it.</p>
        <code>{this.state.error.message}</code>
        <div className="crash-actions">
          <button className="show-btn" onClick={() => this.setState({ error: null })}>
            Try the board again
          </button>
          <button
            className="show-btn is-quiet"
            onClick={() => {
              store.undo();
              this.setState({ error: null });
            }}
          >
            Undo last step
          </button>
          <button className="show-btn is-quiet" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <button
            className="show-btn is-quiet"
            onClick={() => downloadText(`family-fued-save-${Date.now()}.json`, store.exportJson())}
          >
            Download save
          </button>
        </div>
      </div>
    );
  }
}
