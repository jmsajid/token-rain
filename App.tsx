
import React, { useState, useRef, useCallback, useEffect } from 'react';

// Make ethers available globally from the CDN script
declare global {
  interface Window {
    ethereum?: any;
    ethers?: any;
  }
}

// --- TYPE DEFINITIONS ---
type LogStatus = 'idle' | 'pending' | 'success' | 'error';

interface LogEntry {
  recipient: string;
  txHash?: string;
  status: LogStatus;
  message: string;
  timestamp: number;
}

// --- CONSTANTS ---
const RECIPIENT_COUNT = 3;
const TRANSFER_INTERVAL_MS = 2000; // 2 seconds between each batch of transfers
const ERC20_ABI = [
  "function transfer(address to, uint amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

// --- UI HELPER COMPONENTS (defined outside App to prevent re-creation on renders) ---

const WalletIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className || "w-6 h-6"}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 12m15 0a2.25 2.25 0 0 1 2.25 2.25v6a2.25 2.25 0 0 1-2.25 2.25h-1.5a2.25 2.25 0 0 1-2.25-2.25v-6a2.25 2.25 0 0 1 2.25-2.25h1.5Z" />
  </svg>
);

const StatusIcon: React.FC<{ status: LogStatus }> = ({ status }) => {
  switch (status) {
    case 'pending':
      return <div className="w-4 h-4 rounded-full bg-yellow-500 animate-pulse" title="Pending"></div>;
    case 'success':
      return <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-green-500"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>;
    case 'error':
      return <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-red-500"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>;
    default:
      return <div className="w-4 h-4 rounded-full bg-gray-600" title="Idle"></div>;
  }
};

// --- MAIN APPLICATION COMPONENT ---

function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<string[]>(Array(RECIPIENT_COUNT).fill(''));
  const [tokenAddress, setTokenAddress] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [isHolding, setIsHolding] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // FIX: Changed NodeJS.Timeout to number for browser compatibility as setInterval returns a number in the browser.
  const intervalRef = useRef<number | null>(null);

  const connectWallet = async () => {
    setError(null);
    if (!window.ethereum) {
      setError("MetaMask is not installed. Please install it to use this app.");
      return;
    }
    try {
      const provider = new window.ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      const address = await signer.getAddress();
      setAccount(address);
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet.");
      console.error(err);
    }
  };
  
  useEffect(() => {
    const checkConnection = async () => {
      if (window.ethereum) {
        try {
          const provider = new window.ethers.providers.Web3Provider(window.ethereum);
          const accounts = await provider.listAccounts();
          if (accounts.length > 0) {
            setAccount(accounts[0]);
          }
        } catch (err) {
          console.error("Could not check for connected accounts", err);
        }
      }
    };
    checkConnection();
  }, []);

  const handleRecipientChange = (index: number, value: string) => {
    const newRecipients = [...recipients];
    newRecipients[index] = value;
    setRecipients(newRecipients);
  };

  const transferTokens = useCallback(async () => {
    setError(null);
    if (!account || !window.ethers) {
      setError("Wallet not connected.");
      return;
    }

    const validRecipients = recipients.filter(r => window.ethers.utils.isAddress(r));
    if (validRecipients.length === 0) {
      setError("Please provide at least one valid recipient address.");
      return;
    }
    if (!window.ethers.utils.isAddress(tokenAddress)) {
      setError("Invalid ERC20 token contract address.");
      return;
    }
    const amountNum = parseFloat(transferAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid positive transfer amount.");
      return;
    }

    const provider = new window.ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    const tokenContract = new window.ethers.Contract(tokenAddress, ERC20_ABI, signer);

    try {
        const decimals = await tokenContract.decimals();
        const amountToSend = window.ethers.utils.parseUnits(transferAmount, decimals);

        validRecipients.forEach(async (recipient) => {
          const newLog: LogEntry = {
            recipient,
            status: 'pending',
            message: `Initiating transfer of ${transferAmount} tokens...`,
            timestamp: Date.now(),
          };
          setLogs(prevLogs => [newLog, ...prevLogs]);

          try {
            const tx = await tokenContract.transfer(recipient, amountToSend);
            setLogs(prevLogs => prevLogs.map(l => l.timestamp === newLog.timestamp ? { ...l, message: `Transaction sent. Waiting for confirmation...`, txHash: tx.hash } : l));
            
            await tx.wait();

            setLogs(prevLogs => prevLogs.map(l => l.timestamp === newLog.timestamp ? { ...l, status: 'success', message: 'Transfer successful!' } : l));
          } catch (err: any) {
            console.error(`Failed to transfer to ${recipient}:`, err);
            const errorMessage = err.reason || err.message || "Transaction failed.";
            setLogs(prevLogs => prevLogs.map(l => l.timestamp === newLog.timestamp ? { ...l, status: 'error', message: errorMessage } : l));
          }
        });
    } catch(err: any) {
        const errorMessage = "Could not fetch token decimals. Is this a valid ERC20 token contract?";
        setError(errorMessage);
        console.error(err);
    }
  }, [account, recipients, tokenAddress, transferAmount]);

  const handleMouseDown = () => {
    setIsHolding(true);
    transferTokens(); // Fire once immediately
    intervalRef.current = setInterval(transferTokens, TRANSFER_INTERVAL_MS);
  };

  const handleMouseUp = () => {
    setIsHolding(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };
  
  const isFormValid = recipients.some(r => r.length > 0) && tokenAddress.length > 0 && transferAmount.length > 0;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans flex flex-col items-center p-4 sm:p-6">
      <div className="w-full max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
            ERC20 Token Airdropper
          </h1>
          {account ? (
            <div className="flex items-center space-x-3 bg-gray-800 p-2 rounded-lg">
              <WalletIcon className="w-5 h-5 text-purple-400" />
              <span className="text-sm font-mono">{`${account.substring(0, 6)}...${account.substring(account.length - 4)}`}</span>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 flex items-center space-x-2"
            >
              <WalletIcon />
              <span>Connect Wallet</span>
            </button>
          )}
        </header>

        {/* Main Content */}
        <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Panel: Configuration */}
          <div className="bg-gray-800/50 p-6 rounded-xl shadow-lg flex flex-col space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-3 text-gray-100">1. Recipient Addresses</h2>
              <div className="space-y-3">
                {recipients.map((r, i) => (
                  <input
                    key={i}
                    type="text"
                    placeholder={`0x... Address ${i + 1}`}
                    value={r}
                    onChange={(e) => handleRecipientChange(i, e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-md p-3 text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
                    disabled={!account || isHolding}
                  />
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-3 text-gray-100">2. Token Details</h2>
              <div className="space-y-3">
                 <input
                    type="text"
                    placeholder="ERC20 Token Contract Address"
                    value={tokenAddress}
                    onChange={(e) => setTokenAddress(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-md p-3 text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
                    disabled={!account || isHolding}
                  />
                   <input
                    type="number"
                    placeholder="Amount to send each time"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-md p-3 text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
                    disabled={!account || isHolding}
                  />
              </div>
               <p className="text-xs text-gray-500 mt-2">Note: The amount is based on the token's decimals (e.g., 18 for many tokens).</p>
            </div>
             
             <div className="border-t border-gray-700 pt-6">
                 <h2 className="text-xl font-semibold mb-3 text-gray-100">3. Start Sending</h2>
                 <p className="text-sm text-gray-400 mb-4">
                    Press and hold the button below. A new batch of transfers will be initiated every {TRANSFER_INTERVAL_MS / 1000} seconds.
                 </p>
                <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-md text-yellow-300 text-xs mb-4">
                  <strong>Warning:</strong> Each transfer is a separate blockchain transaction. You will need to approve each one in your wallet and pay gas fees.
                </div>
                <button
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp} // Stop if mouse leaves button area
                    onTouchStart={handleMouseDown}
                    onTouchEnd={handleMouseUp}
                    disabled={!account || !isFormValid}
                    className={`w-full py-4 px-6 font-bold text-lg rounded-xl transition-all duration-300 transform flex justify-center items-center
                      ${!account || !isFormValid ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : ''}
                      ${isHolding ? 'bg-red-600 text-white scale-105 shadow-red-500/50' : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:scale-105'}
                      ${account && isFormValid ? 'shadow-lg' : ''}
                    `}
                >
                  {isHolding ? 'SENDING...' : 'HOLD TO SEND TOKENS'}
                </button>
             </div>
          </div>

          {/* Right Panel: Logs */}
          <div className="bg-gray-800/50 p-6 rounded-xl shadow-lg flex flex-col">
            <h2 className="text-xl font-semibold mb-4 text-gray-100 border-b border-gray-700 pb-3">Transaction Log</h2>
            
            {error && <div className="bg-red-900/50 text-red-300 p-3 rounded-md mb-4 text-sm">{error}</div>}

            <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-3 h-96">
              {logs.length === 0 && <div className="text-center text-gray-500 pt-16">Waiting for transactions...</div>}
              {logs.map((log, i) => (
                <div key={log.timestamp + log.recipient} className="bg-gray-900/70 p-3 rounded-lg flex items-start space-x-3 text-sm animate-fade-in">
                   <div className="pt-1"><StatusIcon status={log.status} /></div>
                   <div className="flex-1">
                      <div className="font-mono text-gray-400 text-xs">
                          To: {`${log.recipient.substring(0, 10)}...${log.recipient.substring(log.recipient.length - 8)}`}
                      </div>
                      <p className="text-gray-200">{log.message}</p>
                      {log.txHash && (
                        <a 
                          href={`https://etherscan.io/tx/${log.txHash}`} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-purple-400 hover:underline text-xs font-mono break-all"
                        >
                          View on Etherscan
                        </a>
                      )}
                   </div>
                   <div className="text-xs text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
