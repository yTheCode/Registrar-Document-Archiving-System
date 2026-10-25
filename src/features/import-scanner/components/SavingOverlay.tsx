function SavingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="surface-card rounded-lg p-8 shadow-2xl max-w-md w-full mx-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#eef5fb] mb-4">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#24558d] border-r-transparent"></div>
          </div>
          <h3 className="text-lg font-bold text-[#182a43] mb-2">
            Saving Documents...
          </h3>
          <p className="text-sm text-[#718096]">
            Please wait while we archive your documents. This may take a few moments.
          </p>
        </div>
      </div>
    </div>
  )
}

export default SavingOverlay
