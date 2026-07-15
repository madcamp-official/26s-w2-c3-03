// web/src/App.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Display from './pages/Display';
import Audience from './pages/Audience';
import Dev from './pages/Dev';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/display" element={<Display />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/dev" element={<Dev />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
