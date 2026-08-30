import React, { Component } from 'react'

/**
 * Safety net around the mounted game interface (ModStage). The whole launcher
 * is a single React root with no other boundary; if ANY component inside the
 * game stage throws during render or a lifecycle while a mode is opening, the
 * root unmounts and the window goes permanently black with no way back.
 *
 * Historically the black screen has reappeared whenever a change introduces a
 * runtime error in the mount path — this boundary turns that silent crash
 * into a visible, recoverable screen with a Return to Launcher button, so a
 * broken build can never leave the user stuck on a black window.
 *
 * `onReset` - wire to App's "go back to launcher" so the user can escape even
 * if the interface is the thing that crashed. The boundary is keyed by the
 * current view, so navigating away and re-opening a mode remounts it fresh
 * (the error state is discarded).
 */
export default class StageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || String(error) || 'Unknown error' }
  }

  componentDidCatch(error, info) {
    // Always surface the crash in the console for diagnosing the specific fix
    // that regressed — a silent black screen is much harder to debug than a
    // logged stack.
    console.error('[stage] interface crashed:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, message: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="stage-crash-fallback" role="alert">
        <div className="stage-crash-panel">
          <span className="stage-crash-kicker">SYSTEM MESSAGE</span>
          <h1>THE LAUNCHER HIT A PROBLEM</h1>
          <p>
            Something went wrong while opening this mode. Nothing has been lost
            — you can return to the launcher and pick a mode again.
          </p>
          <p className="stage-crash-detail">{this.state.message}</p>
          <button type="button" onClick={this.handleReset}>
            Return to Launcher
          </button>
        </div>
      </div>
    )
  }
}