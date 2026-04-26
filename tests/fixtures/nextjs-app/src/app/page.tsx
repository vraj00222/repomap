import { Button } from '../components/Button';
import { greet } from '../lib/greet';

/** Home page — entry point for the demo app. */
export default function HomePage() {
  return (
    <main>
      <h1>{greet('world')}</h1>
      <Button label="click me" />
    </main>
  );
}
