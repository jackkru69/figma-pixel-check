export default function TTransparent() {
  return (
    <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[24px] size-full" data-node-id="2:144" data-name="t-transparent">
      <div className="content-stretch flex flex-col items-start overflow-clip p-[20px] relative shrink-0 w-full" data-node-id="2:145" data-name="overlay">
        <div className="bg-gradient-to-b from-[#1570ef] h-[160px] overflow-clip relative rounded-[16px] shrink-0 to-[#53b1fd] w-[335px]" data-node-id="2:146" data-name="photo">
          <div className="absolute bg-[rgba(0,0,0,0.4)] h-[80px] left-0 top-[80px] w-[335px]" data-node-id="2:147" data-name="shade" />
          <p className="[word-break:break-word] absolute font-['Inter:Semi_Bold'] font-semibold leading-[22px] left-[16px] not-italic text-[17px] text-white top-[124px] whitespace-nowrap" data-node-id="2:148">
            Overlay · black 40 %
          </p>
        </div>
      </div>
      <div className="content-stretch flex gap-[12px] items-start overflow-clip p-[20px] relative shrink-0 w-full" data-node-id="2:149" data-name="opacity">
        <div className="bg-[#12b76a] content-stretch flex items-start overflow-clip px-[14px] py-[8px] relative rounded-[16px] shrink-0" data-node-id="2:150" data-name="chip-1">
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[20px] not-italic relative shrink-0 text-[14px] text-white whitespace-nowrap" data-node-id="2:151">
            100 %
          </p>
        </div>
        <div className="bg-[#12b76a] content-stretch flex items-start opacity-60 overflow-clip px-[14px] py-[8px] relative rounded-[16px] shrink-0" data-node-id="2:152" data-name="chip-0.6">
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[20px] not-italic relative shrink-0 text-[14px] text-white whitespace-nowrap" data-node-id="2:153">
            60 %
          </p>
        </div>
        <div className="bg-[#12b76a] content-stretch flex items-start opacity-30 overflow-clip px-[14px] py-[8px] relative rounded-[16px] shrink-0" data-node-id="2:154" data-name="chip-0.3">
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[20px] not-italic relative shrink-0 text-[14px] text-white whitespace-nowrap" data-node-id="2:155">
            30 %
          </p>
        </div>
      </div>
      <div className="[word-break:break-word] content-stretch flex flex-col font-['Inter:Medium'] font-medium gap-[4px] items-start leading-[24px] not-italic overflow-clip p-[20px] relative shrink-0 text-[16px] w-full whitespace-nowrap" data-node-id="2:156" data-name="text-alpha">
        <p className="relative shrink-0 text-[rgba(0,0,0,0.87)]" data-node-id="2:157">
          Text at 87 % black
        </p>
        <p className="relative shrink-0 text-[rgba(0,0,0,0.6)]" data-node-id="2:158">
          Text at 60 % black
        </p>
        <p className="relative shrink-0 text-[rgba(0,0,0,0.38)]" data-node-id="2:159">
          Text at 38 % black
        </p>
      </div>
    </div>
  );
}
