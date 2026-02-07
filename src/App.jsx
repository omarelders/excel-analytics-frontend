import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import HomePage from './pages/Home'
import OrdersByDayPage from './pages/OrdersByDay'
import AllOrdersPage from './pages/AllOrders'
import PaymentProcessingPage from './pages/PaymentProcessing'
import PaymentDataPage from './pages/PaymentData'
import ShipmentDataPage from './pages/ShipmentData'
import AnalyticsPage from './pages/Analytics'
import SettingsPage from './pages/Settings'
import ContentCalendarPage from './pages/ContentCalendar'
import IdeasPage from './pages/Ideas'
import OfflineIndicator from './components/OfflineIndicator'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      {/* Global grain texture overlay */}
      <div className="noise-overlay" />
      <div className="app">
        <OfflineIndicator />
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/orders-by-day" element={<OrdersByDayPage />} />
            <Route path="/all-orders" element={<AllOrdersPage />} />
            <Route path="/payment-processing" element={<PaymentProcessingPage />} />
            <Route path="/payment-data/:fileId" element={<PaymentDataPage />} />
            <Route path="/shipment-data/:fileId" element={<ShipmentDataPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/content-calendar" element={<ContentCalendarPage />} />
            <Route path="/ideas" element={<IdeasPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
