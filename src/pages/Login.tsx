import { useState } from 'react'
import { UserRound, LockKeyhole, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/utils/cn'
import appLogo from '@/assets/logo-256.png'
import { useToast } from '@/components/ui/Toast'
import type { User } from '@/types'

interface LoginProps {
  onLogin: (user: User) => void
}

function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img 
        src={appLogo}
        alt="AdZU Registrar Archive logo"
        className="h-9 w-9 object-contain" 
      />
      <div className="leading-tight">
        <div className={cn(
          'text-[11px] font-bold tracking-[-.02em]',
          inverse ? 'text-white' : 'text-slate-900'
        )}>
          Ateneo de Zamboanga
        </div>
        <div className={cn(
          'text-[11px] font-bold tracking-[-.02em]',
          inverse ? 'text-white' : 'text-slate-900'
        )}>
          University
        </div>
        <div className="mt-0.5 text-[7px] font-bold uppercase tracking-[.18em] text-[#d4a843]">
          Registrar
        </div>
      </div>
    </div>
  )
}

function Field({ 
  label, 
  value, 
  onChange, 
  placeholder, 
  type = 'text', 
  icon, 
  required = false 
}: { 
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  icon?: React.ReactNode
  required?: boolean 
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label-caps text-[10px]">
        {label}
        {required && <span className="ml-1 text-[#b94843]">*</span>}
      </span>
      <span className="relative block">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-2.5 text-[#8995a7]">
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]',
            icon ? 'pl-9' : ''
          )}
        />
      </span>
    </label>
  )
}

function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { showError } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!username || !password) {
      showError('Enter your credentials to continue.')
      return
    }

    setIsLoading(true)

    try {
      const result = await window.electronAPI.login({ username, password })

      if (result.success) {
        onLogin(result.user)
      } else {
        showError(result.error || 'Unable to start this archive session.')
      }
    } catch (err) {
      showError('An error occurred during login. Please try again.')
      console.error('Login error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] bg-[#f4f6f9]">
      {/* Left side - ADZU branding */}
      <section className="login-grid relative hidden w-[62%] overflow-hidden bg-[#1d4277] lg:flex lg:flex-col lg:items-center lg:justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-[#183c70] via-[#24558d] to-[#2f66a5] opacity-90" />
        
        <div className="relative z-10 flex max-w-[600px] flex-col items-center text-center">
          <img 
            src={appLogo}
            alt="AdZU Registrar Archive logo"
            className="mb-8 h-[172px] w-[172px] object-contain drop-shadow-xl" 
          />
          <h1 className="max-w-[560px] text-[31px] font-bold leading-[1.13] tracking-[-.04em] text-white">
            Ateneo de Zamboanga University<br />Registrar's Office
          </h1>
          <p className="mt-5 max-w-[470px] text-sm leading-6 text-[#c2d2e7]">
            A quiet, secure archive for the records that shape every student's journey.
          </p>
        </div>

        <div className="absolute bottom-7 left-9 z-10 text-[9px] leading-4 text-[#b7cbe3]">
          <strong className="text-white">
            Ateneo de Zamboanga University — Secure Document Management
          </strong>
          <br />
          Official Records &amp; Archives Management Office
        </div>
      </section>

      {/* Right side - Login form */}
      <section className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          {/* Logo for mobile */}
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          {/* Login card */}
          <div className="rounded-xl border border-[#e2e6eb] bg-white p-7 shadow-[0_10px_35px_rgba(15,27,45,.08)] sm:p-9">
            {/* Header */}
            <div className="mb-7 text-center">
              <div className="text-[18px] font-bold tracking-[-.03em] text-[#182a43]">
                Portal Authentication
              </div>
              <p className="mt-1.5 text-xs text-[#8290a1]">
                Please enter your credentials to access archives
              </p>
            </div>

            {/* Login form */}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Field
                label="Username or Institutional Email"
                value={username}
                onChange={setUsername}
                placeholder="username@adzu.edu.ph"
                icon={<UserRound size={14} />}
                required
              />

              <div>
                <div className="relative">
                  <Field
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    placeholder="Enter your password"
                    type={showPassword ? 'text' : 'password'}
                    icon={<LockKeyhole size={14} />}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8b97a6] hover:text-[#5a6b81] transition"
                    style={{ marginTop: '13px' }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2.5 text-xs font-bold transition focus-ring disabled:cursor-not-allowed disabled:opacity-50 bg-[#24558d] text-white hover:bg-[#1d4778]"
              >
                {isLoading ? 'Logging in...' : 'Log in'}
              </button>
            </form>

            {/* Helper text */}
            <div className="mt-4 text-center text-[10px] text-[#8290a1]">
              <p>Default credentials for testing:</p>
              <p className="mt-1 font-semibold text-[#34445a]">
                Administrator: admin / admin123
              </p>
              <p className="font-semibold text-[#34445a]">
                Regular Staff: user / user123
              </p>
            </div>
          </div>


        </div>
      </section>
    </div>
  )
}

export default Login
