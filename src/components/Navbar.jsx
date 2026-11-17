import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, List, CreditCard, LayoutGrid, FlaskConical, Menu, X } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import './Navbar.css'

function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
        <ul className="nav-links" onClick={() => setMobileMenuOpen(false)}>
          <li>
            <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>
              <Home size={20} />
              <span>Home</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/all-orders" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>
              <List size={20} />
              <span>All Orders</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/payment-processing" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>
              <CreditCard size={20} />
              <span>Payment Processing</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/content-calendar" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>
              <LayoutGrid size={20} />
              <span>Content Calendar</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/formula-calculator" className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>
              <FlaskConical size={20} />
              <span>Formula Calc</span>
            </NavLink>
          </li>
        </ul>

        {/* Logout & Theme Toggle Section */}
        <div className="nav-actions">
          {/* Desktop theme toggle */}
          <div className="nav-theme-toggle">
            <ThemeToggle />
          </div>
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
