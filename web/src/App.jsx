// web/src/App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Display from './pages/Display';
import Audience from './pages/Audience';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/display" element={<Display />} />
        <Route path="/audience" element={<Audience />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
