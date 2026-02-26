import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
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
import LoginPage from './pages/Login'
import OfflineIndicator from './components/OfflineIndicator'
import './App.css'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app">
          <OfflineIndicator />
          
          <Routes>
            {/* Public route - Login */}
            <Route path="/login" element={<LoginPage />} />
            
            {/* Protected routes */}
            <Route path="/" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <HomePage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/orders-by-day" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <OrdersByDayPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/all-orders" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <AllOrdersPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/payment-processing" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <PaymentProcessingPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/payment-data/:fileId" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <PaymentDataPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/shipment-data/:fileId" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <ShipmentDataPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/analytics" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <AnalyticsPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/settings" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <SettingsPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/content-calendar" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <ContentCalendarPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
            
            <Route path="/ideas" element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <main className="main-content">
                    <IdeasPage />
                  </main>
                </>
              </ProtectedRoute>
            } />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
