import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Book from './pages/Book';
import Admin from './pages/Admin';
import Auth from './pages/Auth';
import Client from './pages/Client';
import './index.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/agendar" element={<Book />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/login" element={<Auth />} />
      <Route path="/cliente" element={<Client />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  </BrowserRouter>
);
