import React, { useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default function GeminiChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMessage = { text: input, sender: 'user' };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(input);
      const response = await result.response;
      
      setMessages((prev) => [...prev, { text: response.text(), sender: 'bot' }]);
    } catch (error) {
      setMessages((prev) => [...prev, { text: "Erro. Verifique se copiou a API Key corretamente para o ficheiro .env", sender: 'bot' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999 }}
        className="bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center"
      >
        <MessageCircle size={28} />
      </button>

      {isOpen && (
        <div 
          style={{ position: 'fixed', bottom: '90px', right: '20px', width: '350px', height: '500px', zIndex: 9999 }}
          className="bg-white rounded-xl shadow-2xl flex flex-col border border-gray-200 overflow-hidden"
        >
          <div className="bg-blue-600 text-white p-4 flex justify-between items-center">
            <h3 className="font-bold">Assistente Rendermates</h3>
            <button onClick={() => setIsOpen(false)} className="hover:text-gray-200">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 p-4 overflow-y-auto bg-gray-50 flex flex-col gap-3">
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm text-center mt-4">Olá! Como posso ajudar com o CRM hoje?</p>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`max-w-[85%] p-3 rounded-lg text-sm ${msg.sender === 'user' ? 'bg-blue-600 text-white self-end rounded-br-none' : 'bg-gray-200 text-gray-800 self-start rounded-bl-none'}`}>
                {msg.text}
              </div>
            ))}
            {isLoading && <div className="text-gray-500 text-sm self-start">A pensar...</div>}
          </div>

          <div className="p-3 border-t bg-white flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Pergunte-me algo..."
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
            <button onClick={handleSend} disabled={isLoading} className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 flex items-center justify-center">
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}