import { Component } from 'react';

/**
 * 렌더 중 예외가 나도 페이지 전체가 흰 화면이 되지 않도록 막는다.
 * fallback 을 주면 그걸, 없으면 재시도 카드를 보여준다.
 */
export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if ('fallback' in this.props) return this.props.fallback;
    return (
      <div className="crash">
        <p>문제가 발생했어요.</p>
        <button onClick={() => this.setState({ failed: false })}>다시 시도</button>
      </div>
    );
  }
}
