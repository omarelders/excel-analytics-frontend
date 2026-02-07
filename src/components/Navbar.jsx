import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, List, CreditCard, LayoutGrid, Lightbulb, Menu, X } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import './Navbar.css'

function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location])

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  return (
    <nav className="navbar">
      <div className="nav-header">
        <div className="nav-brand">
          <span className="logo-text">Gold</span>
          <span className="logo-text-accent">Road</span>
        </div>
        
        <div className="nav-header-actions">
          <ThemeToggle />
          <button 
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile backdrop */}
      <div 
        className={`mobile-backdrop ${mobileMenuOpen ? 'open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <div className={`nav-content ${mobileMenuOpen ? 'open' : ''}`}>
        <ul className="nav-links">
          <li>
            <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''}>
              <Home size={20} />
              <span>Home</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/all-orders" className={({ isActive }) => isActive ? 'active' : ''}>
              <List size={20} />
              <span>All Orders</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/payment-processing" className={({ isActive }) => isActive ? 'active' : ''}>
              <CreditCard size={20} />
              <span>Payment Processing</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/content-calendar" className={({ isActive }) => isActive ? 'active' : ''}>
              <LayoutGrid size={20} />
              <span>Content Calendar</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/ideas" className={({ isActive }) => isActive ? 'active' : ''}>
              <Lightbulb size={20} />
              <span>Ideas</span>
            </NavLink>
          </li>
        </ul>
        {/* Desktop theme toggle */}
        <div className="nav-theme-toggle">
          <ThemeToggle />
        </div>
        {/* Mobile drawer footer */}
        <div className="nav-footer">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  )
}

export default Navbar
